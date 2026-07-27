import io
import base64
import logging

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

try:
    import plotly.graph_objects as go
    HAS_PLOTLY = True
except ImportError:
    HAS_PLOTLY = False

try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

from src.i18n import get_i18n_strings

logger = logging.getLogger(__name__)


def _strip_kaleido_watermark(img_bytes: bytes) -> bytes:
    """Remove Kaleido 0.2.x 'Humanity ex' watermark from bottom of image."""
    if not HAS_PIL:
        return img_bytes
    try:
        img = Image.open(io.BytesIO(img_bytes))
        w, h = img.size
        # Crop bottom 3% of image where watermark appears
        cropped = img.crop((0, 0, w, int(h * 0.97)))
        buf = io.BytesIO()
        cropped.save(buf, format='PNG')
        return buf.getvalue()
    except Exception:
        return img_bytes


def generate_pl_infographic(stmt, lang="sk") -> str:
    """Vygeneruje P&L Sankey diagram: Tržby → Hrubá marža → Čistý zisk."""
    if not stmt:
        return ""
    i = get_i18n_strings(lang)

    revenue = getattr(stmt, 'mainActivityRevenue', None)
    gross = getattr(stmt, 'grossProfit', None)
    net = getattr(stmt, 'netProfitLoss', None)
    staff = getattr(stmt, 'staffCosts', None)
    depreciation = getattr(stmt, 'depreciation', None)
    interest = getattr(stmt, 'interestExpense', None)

    # Potrebujeme aspoň revenue — zvyšok može byť None a waterfall sa postará
    if revenue is None or revenue <= 0:
        return ""

    # Ak chýbajú kľúčové položky alebo sú hodnoty neštandardné pre Sankey → waterfall
    if any(val is None for val in [gross, net, staff, depreciation, interest]):
        return _generate_pl_waterfall(stmt, lang=lang)
    if gross <= 0 or net < 0 or net == 0:
        return _generate_pl_waterfall(stmt, lang=lang)
    # Ak je grossProfit odhadnutý (v skutočnosti prevádzkový zisk, nie hrubá marža),
    # Sankey by zobrazil nesprávne COGS → použi waterfall
    if getattr(stmt, '_gross_profit_estimated', False):
        return _generate_pl_waterfall(stmt, lang=lang)

    if not HAS_PLOTLY:
        return _generate_pl_waterfall(stmt, lang=lang)

    cogs = revenue - gross
    staff_val = abs(staff)
    dep_val = abs(depreciation)
    int_val = abs(interest)
    # Zvyšok: môže byť záporný (= ostatné výnosy presahujúce náklady)
    other_opex = gross - net - (staff_val + dep_val + int_val)

    labels = [
        i.get('sankey_revenue', 'Tržby'),                        # 0
        i.get('sankey_cogs', 'Priame náklady (COGS)'),         # 1
        i.get('sankey_gross_margin', 'Hrubá marža'),                   # 2
        i.get('sankey_staff', 'Osobné náklady'),                # 3
        i.get('sankey_depreciation', 'Odpisy'),                        # 4
        i.get('sankey_interest', 'Úroky'),                         # 5
        i.get('sankey_other_opex', 'Ostatné prevádzkové náklady'),   # 6
        i.get('sankey_net_profit', 'Čistý zisk'),                    # 7
    ]
    colors = [
        "#1e40af", "#ef4444", "#10b981",
        "#ef4444", "#ef4444", "#ef4444", "#ef4444",
        "#10b981",
    ]

    source, target, value, link_color = [], [], [], []

    # Tržby → COGS + Hrubá marža
    if cogs > 0:
        source.append(0); target.append(1); value.append(cogs)
        link_color.append("rgba(239,68,68,0.35)")
    source.append(0); target.append(2); value.append(gross)
    link_color.append("rgba(16,185,129,0.35)")

    # Hrubá marža → náklady
    if staff_val > 0:
        source.append(2); target.append(3); value.append(staff_val)
        link_color.append("rgba(239,68,68,0.35)")
    if dep_val > 0:
        source.append(2); target.append(4); value.append(dep_val)
        link_color.append("rgba(239,68,68,0.35)")
    if int_val > 0:
        source.append(2); target.append(5); value.append(int_val)
        link_color.append("rgba(239,68,68,0.35)")

    # other_opex: kladné = ostatné náklady odchádza z Hrubej marže
    #             záporné = ostatné výnosy pritekajú DO Hrubej marže (nový zdrojový uzol)
    if other_opex > 0:
        source.append(2); target.append(6); value.append(other_opex)
        link_color.append("rgba(239,68,68,0.35)")
    elif other_opex < 0:
        # Ostatné výnosy → Hrubá marža (index 2)
        labels.append(i.get('sankey_other_income', 'Ostatné výnosy'))
        colors.append("#3b82f6")
        idx_ov = len(labels) - 1
        source.append(idx_ov); target.append(2); value.append(abs(other_opex))
        link_color.append("rgba(59,130,246,0.35)")

    # Čistý zisk
    if net > 0:
        source.append(2); target.append(7); value.append(net)
        link_color.append("rgba(16,185,129,0.35)")

    # Sankey validácia: inflow do uzla 2 musí = outflow z uzla 2
    in_to_gross  = gross + (abs(other_opex) if other_opex < 0 else 0)
    out_from_gross = sum(v for s, v in zip(source, value) if s == 2)
    tol = max(in_to_gross * 0.02, 1000)
    if abs(out_from_gross - in_to_gross) > tol:
        return _generate_pl_waterfall(stmt, lang=lang)

    # Explicitne definované orientačné súradnice pre uzly.
    # COGS a Hrubá marža sú umelo umiestnené do stredného stĺpca (x=0.5),
    # aby sa obrovské vlákno COGS netiahlo až na koniec a neprekrývalo ostatné.
    # Pravé uzly posunuté z 0.99 na 0.82 aby popisky nepretiekali za okraj.
    node_x = [0.01, 0.45, 0.45, 0.82, 0.82, 0.82, 0.82, 0.82]
    node_y = [0.5, 0.15, 0.75, 0.08, 0.30, 0.50, 0.72, 0.92]

    fig = go.Figure(data=[go.Sankey(
        arrangement="snap",
        node=dict(
            pad=25,
            thickness=30,
            line=dict(color="white", width=1),
            label=labels,
            color=colors,
            x=node_x,
            y=node_y
        ),
        link=dict(source=source, target=target, value=value, color=link_color),
    )])
    fig.update_layout(
        font=dict(size=11, family='DejaVu Sans', color='#0f172a'),
        margin=dict(l=10, r=130, t=20, b=30),
        paper_bgcolor='rgba(0,0,0,0)',
        plot_bgcolor='rgba(0,0,0,0)',
    )

    try:
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            img_bytes = fig.to_image(format="png", width=920, height=420, scale=2, engine="kaleido")
        img_bytes = _strip_kaleido_watermark(img_bytes)
        return base64.b64encode(img_bytes).decode('utf-8')
    except Exception as e:
        logger.warning(f"PL Sankey chart failed: {e}")
        return _generate_pl_waterfall(stmt, lang=lang)


def generate_cashflow_waterfall(stmt, lang="sk") -> str:
    """Vygeneruje Sankey graf rozkladenia cash flow."""
    if not stmt:
        return ""
    i = get_i18n_strings(lang)

    net_profit = getattr(stmt, 'netProfitLoss', None)
    depreciation = getattr(stmt, 'depreciation', None)
    ocf = getattr(stmt, 'operatingCashFlow', None)

    # Prísna kontrola dát
    if any(val is None for val in [net_profit, depreciation, ocf]):
        return ""

    if net_profit <= 0 or ocf <= 0:
        return _generate_cashflow_waterfall(stmt, lang=lang)

    if not HAS_PLOTLY:
        return _generate_cashflow_waterfall(stmt, lang=lang)

    dep_val = abs(depreciation)
    gross_cf = net_profit + dep_val
    working_capital_effect = ocf - gross_cf  # kladné = kladné zmeny v PK, záporné = odtok

    if working_capital_effect >= 0:
        # Jednoduchý prípad: Čistý zisk + Odpisy + Zmeny v PK → Prevádzkový CF
        # Uzly: 0=Čistý zisk, 1=Odpisy, 2=Zmeny v PK, 3=Prevádzkový CF
        labels = [i.get('sankey_net_profit', 'Čistý zisk'), i.get('sankey_depreciation', 'Odpisy'), i.get('sankey_wc_changes', 'Zmeny v prac. kapitále'), i.get('chart_operating_cf', 'Prevádzkový CF')]
        colors = ["#10b981", "#3b82f6", "#22c55e", "#10b981"]
        source = [0, 1]
        target = [3, 3]
        value = [net_profit, dep_val]
        link_color = ["rgba(16,185,129,0.4)", "rgba(59,130,246,0.4)"]
        node_x = [0.01, 0.01, 0.01, 0.82]
        node_y = [0.25, 0.60, 0.90, 0.50]
        if working_capital_effect > 0:
            source.append(2); target.append(3); value.append(working_capital_effect)
            link_color.append("rgba(34,197,94,0.4)")
    else:
        # BUG FIX: Záporný efekt PK. Schéma: 
        # Čistý zisk + Odpisy → Hrubý CF
        # Hrubý CF → Prevádzkový CF + Odtok do PK
        # Uzly: 0=Čistý zisk, 1=Odpisy, 2=Hrubý peňažný tok, 3=Prevádzkový CF, 4=Záporné zmeny v PK
        labels = [i.get('sankey_net_profit', 'Čistý zisk'), i.get('sankey_depreciation', 'Odpisy'), i.get('sankey_gross_cf', 'Hrubý peňažný tok'), i.get('chart_operating_cf', 'Prevádzkový CF'), i.get('sankey_negative_wc', 'Záporné zmeny v prac. kapitále')]
        colors = ["#10b981", "#3b82f6", "#1d4ed8", "#10b981", "#ef4444"]
        source = [0, 1, 2, 2]
        target = [2, 2, 3, 4]
        value = [net_profit, dep_val, ocf, abs(working_capital_effect)]
        link_color = [
            "rgba(16,185,129,0.4)", "rgba(59,130,246,0.4)",
            "rgba(16,185,129,0.4)", "rgba(239,68,68,0.4)"
        ]
        node_x = [0.01, 0.01, 0.45, 0.82, 0.82]
        node_y = [0.25, 0.70, 0.50, 0.25, 0.75]

    fig = go.Figure(data=[go.Sankey(
        arrangement="snap",
        node=dict(
            pad=20,
            thickness=25,
            line=dict(color="white", width=1),
            label=labels,
            color=colors,
            x=node_x,
            y=node_y,
        ),
        link=dict(source=source, target=target, value=value, color=link_color),
    )])
    fig.update_layout(
        font=dict(size=11, family='DejaVu Sans', color='#0f172a'),
        margin=dict(l=10, r=130, t=20, b=30),
        paper_bgcolor='rgba(0,0,0,0)',
        plot_bgcolor='rgba(0,0,0,0)',
    )

    try:
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            img_bytes = fig.to_image(format="png", width=920, height=400, scale=2, engine="kaleido")
        img_bytes = _strip_kaleido_watermark(img_bytes)
        return base64.b64encode(img_bytes).decode('utf-8')
    except Exception as e:
        logger.warning(f"CF Sankey chart failed: {e}")
        return _generate_cashflow_waterfall(stmt, lang=lang)


def generate_balance_sheet_infographic(stmt, lang="sk") -> str:
    """Vygeneruje Sankey infografiku štruktúry súvahy."""
    if not stmt:
        return ""
    i = get_i18n_strings(lang)

    current = getattr(stmt, 'currentAssets', None)
    inventory = getattr(stmt, 'inventory', None)
    cash = getattr(stmt, 'cashAndEquivalents', None)
    receivables = getattr(stmt, 'tradeReceivables', None)
    total_assets = getattr(stmt, 'totalAssets', None)
    equity = getattr(stmt, 'equity', None)
    short_liab = getattr(stmt, 'shortTermLiabilities', None)
    long_liab = getattr(stmt, 'longTermLiabilities', None)

    # Prísna kontrola dát — všetky musia byť dostupné
    if any(val is None for val in [current, inventory, cash, receivables, total_assets, equity, short_liab, long_liab]):
        return ""

    # BUG FIX: záporné vlastné imanie je platná ekonomická situácia, ale
    # waterfall ho zobrazuje so zápornými percentami čo je mätúce.
    # V takom prípade Sankey jednoducho nevygenerujeme a waterfall zobrazí
    # len Aktíva (záväzky stranu vynecháme keď je equity < 0)
    if total_assets <= 0:
        return ""

    if not HAS_PLOTLY:
        return _generate_balance_sheet_waterfall(stmt, lang=lang)

    non_current = max(0, total_assets - current)
    total_liab = short_liab + long_liab

    # BUG FIX #1: komponenty obežného majetku nesmú presahovať currentAssets.
    # Ak dátová extrakcia vráti väčšie čiastky, proporcionálne ich zmenšíme.
    raw_components = cash + receivables + inventory
    if raw_components > current and raw_components > 0:
        scale = current / raw_components
        cash = cash * scale
        receivables = receivables * scale
        inventory = inventory * scale
        other_current = 0.0
    elif raw_components == 0 and current > 0:
        # Holding firma bez subitems — celý current cez "Ostatný obežný majetok"
        other_current = float(current)
    else:
        other_current = max(0.0, current - raw_components)

    # BUG FIX #2: Pravá strana — outflow z "Celkové aktíva" musí = total_assets.
    # Namiesto umelého škálovania (ktoré skresľuje dáta) vypočítame "Ostatné pasíva",
    # čo predstavuje rezervy, bankové úvery a časové rozlíšenie, ktoré nie sú
    # explicitne extrahované v krátkodobých/dlhodobých záväzkoch.
    equity_pos = max(0.0, float(equity))
    known_liab = short_liab + long_liab
    ostatne_pasiva = max(0.0, total_assets - equity_pos - known_liab)

    liab_flow = known_liab + ostatne_pasiva
    equity_flow = equity_pos

    source, target, value, link_color = [], [], [], []

    # Sada uzlov:
    labels = [
        i.get('sankey_cash', 'Hotovosť'),         # 0
        i.get('sankey_receivables', 'Pohľadávky'),       # 1
        i.get('sankey_inventory', 'Zásoby'),           # 2
        i.get('sankey_other_current', 'Ostat. obež. maj.'),# 3
        i.get('sankey_current_assets', 'Obežný majetok'),   # 4
        i.get('sankey_non_current', 'Dlhodobý majetok'), # 5
        i.get('sankey_total_assets', 'Celkové aktíva'),   # 6
        i.get('sankey_liabilities', 'Záväzky'),             # 7 (Záväzky — zdroj na rozdelenie do podkategórií)
        i.get('sankey_equity', 'Vlastné imanie'),   # 8
        i.get('sankey_short_liab', 'Krátkodobé záväzky'),  # 9
        i.get('sankey_long_liab', 'Dlhodobé záväzky'),    # 10
        i.get('sankey_other_pasiva', 'Ostatné pasíva'),   # 11
    ]
    colors = [
        "#34d399", "#34d399", "#34d399", "#34d399",
        "#10b981", "#0ea5e9",
        "#1e293b",
        "#f43f5e", "#10b981",
        "#e11d48", "#e11d48", "#e11d48",
    ]

    # Ľavá strana: položky → Obežný majetok
    if cash > 0:       source.append(0); target.append(4); value.append(cash);        link_color.append("rgba(16,185,129,0.25)")
    if receivables > 0:source.append(1); target.append(4); value.append(receivables); link_color.append("rgba(16,185,129,0.25)")
    if inventory > 0:  source.append(2); target.append(4); value.append(inventory);   link_color.append("rgba(16,185,129,0.25)")
    if other_current > 0: source.append(3); target.append(4); value.append(other_current); link_color.append("rgba(16,185,129,0.25)")

    # Stred: Obežný + Dlhodobý → Celkové aktíva
    if current > 0:    source.append(4); target.append(6); value.append(current);     link_color.append("rgba(16,185,129,0.35)")
    if non_current > 0:source.append(5); target.append(6); value.append(non_current); link_color.append("rgba(16,185,129,0.35)")

    # Pravá strana: Celkové aktíva → Záväzky a iné + VK
    if liab_flow > 0:
        source.append(6); target.append(7); value.append(liab_flow);   link_color.append("#fecaca")
    if equity_flow > 0:
        source.append(6); target.append(8); value.append(equity_flow); link_color.append("rgba(16,185,129,0.35)")

    if short_liab > 0: source.append(7); target.append(9);  value.append(short_liab); link_color.append("#fca5a5")
    if long_liab > 0:  source.append(7); target.append(10); value.append(long_liab);  link_color.append("#fca5a5")
    if ostatne_pasiva > 0: source.append(7); target.append(11); value.append(ostatne_pasiva); link_color.append("#fca5a5")

    # Explicitné fixné súradnice — pravé uzly posunuté z 0.99 na 0.85
    # aby popisky nepretiekali za pravý okraj
    # x=0 je vľavo, x=1 vpravo
    node_x = [0.01, 0.01, 0.01, 0.01, 0.22, 0.22, 0.5, 0.72, 0.85, 0.85, 0.85, 0.85]
    node_y = [0.1, 0.3, 0.5, 0.8, 0.25, 0.75, 0.5, 0.7, 0.15, 0.45, 0.68, 0.88]

    fig = go.Figure(data=[go.Sankey(
        arrangement="snap",
        node=dict(
            pad=14,
            thickness=18,
            line=dict(color="white", width=1),
            label=labels,
            color=colors,
            x=node_x,
            y=node_y,
        ),
        link=dict(source=source, target=target, value=value, color=link_color),
    )])
    fig.update_layout(
        font=dict(size=11, family='DejaVu Sans', color='#0f172a'),
        margin=dict(l=10, r=140, t=20, b=40),
        paper_bgcolor='rgba(0,0,0,0)',
        plot_bgcolor='rgba(0,0,0,0)',
    )

    try:
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            img_bytes = fig.to_image(format="png", width=920, height=460, scale=2, engine="kaleido")
        img_bytes = _strip_kaleido_watermark(img_bytes)
        return base64.b64encode(img_bytes).decode('utf-8')
    except Exception as e:
        logger.warning(f"BS Sankey chart failed: {e}")
        return _generate_balance_sheet_waterfall(stmt, lang=lang)


# ─── Fallback Matplotlib charts ────────────────────────────────────────────────

def _to_base64(fig, width, height):
    try:
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            img_bytes = fig.to_image(format="png", width=width, height=height, scale=2, engine="kaleido")
        img_bytes = _strip_kaleido_watermark(img_bytes)
        return base64.b64encode(img_bytes).decode('utf-8')
    except Exception as e:
        logger.warning(f"Plotly fallback chart failed: {e}")
        return ""


def _adaptive_fmt(val: float) -> str:
    """Format value adaptively based on magnitude.

    Millions for >= 1M EUR, thousands for >= 1k EUR, raw EUR otherwise.
    """
    abs_val = abs(val)
    if abs_val >= 1_000_000:
        return f"{val / 1e6:.1f} M €"
    elif abs_val >= 10_000:
        return f"{val / 1e3:.0f}k €"
    elif abs_val >= 1_000:
        return f"{val / 1e3:.1f}k €"
    else:
        return f"{val:.0f} €"


def _waterfall_to_bars(steps):
    """Convert waterfall steps to bar data with computed bases.

    Returns bar y-values, bases, colors, and text labels for waterfall rendering.
    """
    running = 0
    bar_y = []
    bar_base = []
    bar_colors = []
    bar_text = []
    for s in steps:
        measure = s['measure']
        val = s.get('y', 0)
        if measure == 'absolute':
            bar_base.append(0)
            bar_y.append(val)
            bar_colors.append('#1e40af')
            running = val
        elif measure == 'relative':
            if val < 0:
                bar_base.append(running + val)
                bar_y.append(abs(val))
                bar_colors.append('#ef4444')
            else:
                bar_base.append(running)
                bar_y.append(val)
                bar_colors.append('#10b981')
            running += val
        elif measure == 'total':
            bar_base.append(0)
            bar_y.append(running)
            bar_colors.append('#1e40af' if running >= 0 else '#ef4444')
        bar_text.append(_adaptive_fmt(val) if measure != 'total' else _adaptive_fmt(running))
    return bar_y, bar_base, bar_colors, bar_text


def _matplotlib_waterfall(steps, title, lang="sk"):
    """Render a waterfall chart using matplotlib (Kaleido-safe).

    Kaleido 0.2.1 completely ignores the `base` parameter for go.Bar,
    so all bars start from zero. Matplotlib's `bottom` parameter works
    correctly for true waterfall/cascade charts.
    """
    bar_y, bar_base, bar_colors, bar_text = _waterfall_to_bars(steps)
    x_labels = [s['name'].replace('<br>', '\n') for s in steps]
    n = len(steps)

    fig, ax = plt.subplots(figsize=(8, 3.5), dpi=150)
    fig.patch.set_alpha(0)
    ax.set_facecolor('none')

    x_pos = range(n)
    bars = ax.bar(x_pos, bar_y, bottom=bar_base, color=bar_colors, width=0.6, edgecolor='white', linewidth=0.5)

    # Add value labels on top/bottom of each bar
    for idx, bar in enumerate(bars):
        base = bar_base[idx]
        height = bar_y[idx]
        top = base + height
        label = bar_text[idx]
        if bar_base[idx] > 0 or (bar_base[idx] == 0 and height >= 0):
            ax.text(idx, top + max(bar_y) * 0.02, label, ha='center', va='bottom',
                    fontsize=9, color='#475569', fontweight='medium')
        else:
            ax.text(idx, base - max(bar_y) * 0.02, label, ha='center', va='top',
                    fontsize=9, color='#475569', fontweight='medium')

    # Connector lines between bars
    for idx in range(n - 1):
        if steps[idx]['measure'] == 'absolute' or steps[idx]['measure'] == 'relative':
            left_top = bar_base[idx] + bar_y[idx] if steps[idx].get('y', 0) >= 0 else bar_base[idx]
            right_base = bar_base[idx + 1]
            ax.plot([idx + 0.3, idx + 0.7], [left_top, left_top],
                    color='#94a3b8', linewidth=0.8, linestyle='--')

    ax.set_xticks(x_pos)
    ax.set_xticklabels(x_labels, fontsize=9, color='#64748b')
    ax.set_title(title, fontsize=13, color='#0f172a', fontweight='bold', pad=10)
    ax.tick_params(axis='y', labelsize=9, colors='#64748b')
    from matplotlib.ticker import FuncFormatter
    _max_abs = max(abs(v) for v in bar_y) if bar_y else 0
    if _max_abs >= 1_000_000:
        ax.yaxis.set_major_formatter(FuncFormatter(lambda x, _: f'{x/1e6:.0f}M'))
    elif _max_abs >= 10_000:
        ax.yaxis.set_major_formatter(FuncFormatter(lambda x, _: f'{x/1e3:.0f}k'))
    else:
        ax.yaxis.set_major_formatter(FuncFormatter(lambda x, _: f'{x/1e3:.1f}k'))
    ax.grid(axis='y', color='#e2e8f0', linewidth=0.5, alpha=0.7)
    ax.set_axisbelow(True)
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['left'].set_color('#e2e8f0')
    ax.spines['bottom'].set_color('#e2e8f0')

    plt.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format='png', bbox_inches='tight', transparent=True)
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode('utf-8')


def _generate_pl_waterfall(stmt, lang="sk") -> str:
    """Waterfall P&L chart using matplotlib (Kaleido cannot render base parameter)."""
    if not stmt: return ""
    i = get_i18n_strings(lang)
    revenue = getattr(stmt, 'mainActivityRevenue', None)
    gross = getattr(stmt, 'grossProfit', None)
    net = getattr(stmt, 'netProfitLoss', None)
    staff = getattr(stmt, 'staffCosts', None)
    depreciation = getattr(stmt, 'depreciation', None)
    interest = getattr(stmt, 'interestExpense', None)

    if revenue is None or revenue == 0: return ""

    steps = []
    steps.append({'name': i.get('chart_revenue', 'Tržby'), 'measure': 'absolute', 'y': revenue})
    if gross is not None:
        cogs = revenue - gross
        if cogs > 0:
            steps.append({'name': 'COGS', 'measure': 'relative', 'y': -cogs})
        steps.append({'name': i.get('sankey_gross_margin_short', 'Hrubá marža'), 'measure': 'total'})

    if staff is not None and staff != 0:
        steps.append({'name': i.get('sankey_staff_short', 'Osobné náklady'), 'measure': 'relative', 'y': -abs(staff)})
    if depreciation is not None and depreciation != 0:
        steps.append({'name': i.get('sankey_depreciation', 'Odpisy'), 'measure': 'relative', 'y': -abs(depreciation)})
    if interest is not None and interest != 0:
        steps.append({'name': i.get('sankey_interest', 'Úroky'), 'measure': 'relative', 'y': -abs(interest)})
    if net is not None:
        steps.append({'name': i.get('sankey_net_profit_short', 'Čistý zisk'), 'measure': 'total'})

    if len(steps) < 3: return ""

    try:
        return _matplotlib_waterfall(steps, i.get('chart_pnl', 'Výkaz ziskov a strát'), lang=lang)
    except Exception as e:
        logger.warning(f"PL waterfall matplotlib chart failed: {e}")
        return ""


def _generate_cashflow_waterfall(stmt, lang="sk") -> str:
    """Waterfall Cash Flow chart using matplotlib (Kaleido cannot render base parameter)."""
    if not stmt: return ""
    i = get_i18n_strings(lang)
    net_profit = getattr(stmt, 'netProfitLoss', None)
    depreciation = getattr(stmt, 'depreciation', None)
    ocf = getattr(stmt, 'operatingCashFlow', None)
    if net_profit is None and ocf is None: return ""

    steps = []
    if net_profit is not None:
        steps.append({'name': i.get('sankey_net_profit_short', 'Čistý zisk'), 'measure': 'absolute', 'y': net_profit})
    if depreciation is not None and depreciation != 0:
        steps.append({'name': i.get('sankey_depreciation', 'Odpisy'), 'measure': 'relative', 'y': abs(depreciation)})
    if net_profit is not None and depreciation is not None and ocf is not None:
        wc_change = ocf - (net_profit + abs(depreciation))
        if wc_change != 0:
            steps.append({'name': i.get('sankey_wc_short', 'Zmeny v PK'), 'measure': 'relative', 'y': wc_change})
    if ocf is not None:
        steps.append({'name': i.get('sankey_operating_cf_short', 'Prevádz. CF'), 'measure': 'total'})

    if len(steps) < 2: return ""

    try:
        return _matplotlib_waterfall(steps, i.get('sankey_operating_cf_title', 'Prevádzkový Cash Flow'), lang=lang)
    except Exception as e:
        logger.warning(f"CF waterfall matplotlib chart failed: {e}")
        return ""


def _generate_balance_sheet_waterfall(stmt, lang="sk") -> str:
    """Proper balance sheet composition chart using Plotly."""
    if not stmt: return ""
    i = get_i18n_strings(lang)
    current = getattr(stmt, 'currentAssets', None) or 0
    inventory = getattr(stmt, 'inventory', None) or 0
    cash = getattr(stmt, 'cashAndEquivalents', None) or 0
    receivables = getattr(stmt, 'tradeReceivables', None) or 0
    total_assets = getattr(stmt, 'totalAssets', None) or 0
    equity = getattr(stmt, 'equity', None) or 0
    short_liab = getattr(stmt, 'shortTermLiabilities', None) or 0
    long_liab = getattr(stmt, 'longTermLiabilities', None) or 0

    if total_assets <= 0: return ""
    non_current = total_assets - current

    fig = go.Figure()

    # Assets Bar
    labels_a = [i.get('sankey_non_current', 'Dlhodobý majetok'), i.get('sankey_inventory', 'Zásoby'), i.get('sankey_receivables', 'Pohľadávky'), i.get('sankey_cash', 'Hotovosť')]
    values_a = [non_current, inventory, receivables, cash]
    colors_a = ['#1e40af', '#3b82f6', '#60a5fa', '#93c5fd']
    
    for l, v, c in zip(labels_a, values_a, colors_a):
        if v > 0:
            fig.add_trace(go.Bar(
                y=[i.get('sankey_assets', 'Aktíva')], x=[v], name=f"{l} ({v/total_assets*100:.0f}%)", orientation='h', marker_color=c,
                text=f"{v/total_assets*100:.0f}%", textposition='inside', insidetextanchor='middle'
            ))

    # Capital Bar
    total_cap = equity + short_liab + long_liab
    if total_cap == 0: total_cap = total_assets

    labels_c = [i.get('sankey_equity', 'Vlastné imanie'), i.get('sankey_short_liab', 'Krátkodobé záv.'), i.get('sankey_long_liab', 'Dlhodobé záv.')]
    values_c = [abs(equity), short_liab, long_liab]
    colors_c = ['#10b981' if equity > 0 else '#ef4444', '#f59e0b', '#ef4444']
    
    for l, v, c in zip(labels_c, values_c, colors_c):
        if v > 0:
            name = f"{l} ({v/abs(total_cap)*100:.0f}%)"
            fig.add_trace(go.Bar(
                y=[i.get('sankey_pasiva', 'Pasíva')], x=[v], name=name, orientation='h', marker_color=c,
                text=f"{v/abs(total_cap)*100:.0f}%", textposition='inside', insidetextanchor='middle'
            ))

    fig.update_layout(
        barmode='stack',
        title=dict(text=i.get('chart_balance_structure', 'Štruktúra majetku a zdrojov'), font=dict(size=14, color='#0f172a')),
        plot_bgcolor='rgba(0,0,0,0)',
        paper_bgcolor='rgba(0,0,0,0)',
        margin=dict(l=80, r=20, t=50, b=100),
        legend=dict(orientation="h", yanchor="top", y=-0.1, xanchor="center", x=0.5, font=dict(size=10, color='#475569')),
        xaxis=dict(showgrid=True, gridcolor='#e2e8f0', zeroline=True, tickfont=dict(color='#64748b')),
        yaxis=dict(showgrid=False, tickfont=dict(size=12, color='#0f172a', weight='bold'))
    )
    return _to_base64(fig, 800, 300)
