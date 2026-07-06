import io
import base64
import logging

import matplotlib.pyplot as plt

try:
    import plotly.graph_objects as go
    HAS_PLOTLY = True
except ImportError:
    HAS_PLOTLY = False

logger = logging.getLogger(__name__)


def generate_pl_infographic(stmt) -> str:
    """Vygeneruje P&L Sankey diagram: Tržby → Hrubá marža → Čistý zisk."""
    if not stmt:
        return ""

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
        return _generate_pl_waterfall(stmt)
    if gross <= 0 or net < 0:
        return _generate_pl_waterfall(stmt)

    if not HAS_PLOTLY:
        return _generate_pl_waterfall(stmt)

    cogs = revenue - gross
    staff_val = abs(staff)
    dep_val = abs(depreciation)
    int_val = abs(interest)
    # Zvyšok: môže byť záporný (= ostatné výnosy presahujúce náklady)
    other_opex = gross - net - (staff_val + dep_val + int_val)

    labels = [
        "Tržby",                        # 0
        "Priame náklady (COGS)",         # 1
        "Hrubá marža",                   # 2
        "Osobné náklady",                # 3
        "Odpisy",                        # 4
        "Úroky",                         # 5
        "Ostatné prevádzkové náklady",   # 6
        "Čistý zisk",                    # 7
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
        labels.append("Ostatné výnosy")
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
        return _generate_pl_waterfall(stmt)

    # Explicitne definované orientačné súradnice pre uzly.
    # COGS a Hrubá marža sú umelo umiestnené do stredného stĺpca (x=0.5),
    # aby sa obrovské vlákno COGS netiahlo až na koniec a neprekrývalo ostatné.
    node_x = [0.01, 0.5, 0.5, 0.99, 0.99, 0.99, 0.99, 0.99]
    node_y = [0.5, 0.2, 0.8, 0.1, 0.3, 0.5, 0.7, 0.9]

    fig = go.Figure(data=[go.Sankey(
        arrangement="snap",
        node=dict(
            pad=15,
            thickness=20,
            line=dict(color="white", width=0),
            label=labels,
            color=colors,
            x=node_x,
            y=node_y
        ),
        link=dict(source=source, target=target, value=value, color=link_color),
    )])
    fig.update_layout(
        font_size=18,
        margin=dict(l=10, r=10, t=10, b=10),
        paper_bgcolor='rgba(0,0,0,0)',
        plot_bgcolor='rgba(0,0,0,0)',
    )

    try:
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            # Increased height for more vertical space in P&L Sankey
            img_bytes = fig.to_image(format="png", width=860, height=400, scale=2, engine="kaleido")
        return base64.b64encode(img_bytes).decode('utf-8')
    except Exception as e:
        logger.warning(f"PL Sankey chart failed: {e}")
        return _generate_pl_waterfall(stmt)


def generate_cashflow_waterfall(stmt) -> str:
    """Vygeneruje Sankey graf rozkladenia cash flow."""
    if not stmt:
        return ""

    net_profit = getattr(stmt, 'netProfitLoss', None)
    depreciation = getattr(stmt, 'depreciation', None)
    ocf = getattr(stmt, 'operatingCashFlow', None)

    # Prísna kontrola dát
    if any(val is None for val in [net_profit, depreciation, ocf]):
        return ""

    if net_profit <= 0 or ocf <= 0:
        return _generate_cashflow_waterfall(stmt)

    if not HAS_PLOTLY:
        return _generate_cashflow_waterfall(stmt)

    dep_val = abs(depreciation)
    gross_cf = net_profit + dep_val
    working_capital_effect = ocf - gross_cf  # kladné = kladné zmeny v PK, záporné = odtok

    if working_capital_effect >= 0:
        # Jednoduchý prípad: Čistý zisk + Odpisy + Zmeny v PK → Prevádzkový CF
        # Uzly: 0=Čistý zisk, 1=Odpisy, 2=Zmeny v PK, 3=Prevádzkový CF
        labels = ["Čistý zisk", "Odpisy", "Zmeny v prac. kapitále", "Prevádzkový CF"]
        colors = ["#10b981", "#3b82f6", "#22c55e", "#10b981"]
        source = [0, 1]
        target = [3, 3]
        value = [net_profit, dep_val]
        link_color = ["rgba(16,185,129,0.4)", "rgba(59,130,246,0.4)"]
        if working_capital_effect > 0:
            source.append(2); target.append(3); value.append(working_capital_effect)
            link_color.append("rgba(34,197,94,0.4)")
    else:
        # BUG FIX: Záporný efekt PK. Schéma: 
        # Čistý zisk + Odpisy → Hrubý CF
        # Hrubý CF → Prevádzkový CF + Odtok do PK
        # Uzly: 0=Čistý zisk, 1=Odpisy, 2=Hrubý peňažný tok, 3=Prevádzkový CF, 4=Záporné zmeny v PK
        labels = ["Čistý zisk", "Odpisy", "Hrubý peňažný tok", "Prevádzkový CF", "Záporné zmeny v prac. kapitále"]
        colors = ["#10b981", "#3b82f6", "#1d4ed8", "#10b981", "#ef4444"]
        source = [0, 1, 2, 2]
        target = [2, 2, 3, 4]
        value = [net_profit, dep_val, ocf, abs(working_capital_effect)]
        link_color = [
            "rgba(16,185,129,0.4)", "rgba(59,130,246,0.4)",
            "rgba(16,185,129,0.4)", "rgba(239,68,68,0.4)"
        ]

    fig = go.Figure(data=[go.Sankey(
        node=dict(
            pad=15,
            thickness=20,
            line=dict(color="white", width=0),
            label=labels,
            color=colors,
        ),
        link=dict(source=source, target=target, value=value, color=link_color),
    )])
    fig.update_layout(
        font_size=18,
        margin=dict(l=10, r=10, t=10, b=10),
        paper_bgcolor='rgba(0,0,0,0)',
        plot_bgcolor='rgba(0,0,0,0)',
    )

    try:
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            # Increased height for more vertical space in Cash Flow Sankey
            img_bytes = fig.to_image(format="png", width=860, height=400, scale=2, engine="kaleido")
        return base64.b64encode(img_bytes).decode('utf-8')
    except Exception as e:
        logger.warning(f"CF Sankey chart failed: {e}")
        return _generate_cashflow_waterfall(stmt)


def generate_balance_sheet_infographic(stmt) -> str:
    """Vygeneruje Sankey infografiku štruktúry súvahy."""
    if not stmt:
        return ""

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
        return _generate_balance_sheet_waterfall(stmt)

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
        "Hotovosť",         # 0
        "Pohľadávky",       # 1
        "Zásoby",           # 2
        "Ostat. obež. maj.",# 3
        "Obežný majetok",   # 4
        "Dlhodobý majetok", # 5
        "Celkové aktíva",   # 6
        "Záväzky a iné",    # 7
        "Vlastné imanie",   # 8
        "Krátkodobé záv.",  # 9
        "Dlhodobé záv.",    # 10
        "Ostatné pasíva",   # 11
    ]
    colors = [
        "#22c55e", "#22c55e", "#22c55e", "#22c55e",
        "#16a34a", "#16a34a",
        "#3b82f6",
        "#ef4444", "#10b981",
        "#dc2626", "#dc2626", "#dc2626",
    ]

    # Ľavá strana: položky → Obežný majetok
    if cash > 0:       source.append(0); target.append(4); value.append(cash);        link_color.append("#d1fae5")
    if receivables > 0:source.append(1); target.append(4); value.append(receivables); link_color.append("#d1fae5")
    if inventory > 0:  source.append(2); target.append(4); value.append(inventory);   link_color.append("#d1fae5")
    if other_current > 0: source.append(3); target.append(4); value.append(other_current); link_color.append("#d1fae5")

    # Stred: Obežný + Dlhodobý → Celkové aktíva
    if current > 0:    source.append(4); target.append(6); value.append(current);     link_color.append("#bbf7d0")
    if non_current > 0:source.append(5); target.append(6); value.append(non_current); link_color.append("#bbf7d0")

    # Pravá strana: Celkové aktíva → Záväzky a iné + VK
    if liab_flow > 0:
        source.append(6); target.append(7); value.append(liab_flow);   link_color.append("#fecaca")
    if equity_flow > 0:
        source.append(6); target.append(8); value.append(equity_flow); link_color.append("#bbf7d0")

    if short_liab > 0: source.append(7); target.append(9);  value.append(short_liab); link_color.append("#fca5a5")
    if long_liab > 0:  source.append(7); target.append(10); value.append(long_liab);  link_color.append("#fca5a5")
    if ostatne_pasiva > 0: source.append(7); target.append(11); value.append(ostatne_pasiva); link_color.append("#fca5a5")

    # Pridáme explicitné fixné súradnice, aby sme predišli prekríženiu
    # x=0 je vľavo, x=1 vpravo
    node_x = [0.01, 0.01, 0.01, 0.01, 0.25, 0.25, 0.5, 0.75, 0.99, 0.99, 0.99, 0.99]
    node_y = [0.1, 0.3, 0.5, 0.8, 0.25, 0.75, 0.5, 0.7, 0.2, 0.5, 0.7, 0.9]

    fig = go.Figure(data=[go.Sankey(
        arrangement="snap",
        node=dict(
            pad=20,
            thickness=22,
            line=dict(color="white", width=0),
            label=labels,
            color=colors,
            x=node_x,
            y=node_y,
        ),
        link=dict(source=source, target=target, value=value, color=link_color),
    )])
    fig.update_layout(
        font_size=18,
        margin=dict(l=15, r=15, t=20, b=45),
        paper_bgcolor='rgba(0,0,0,0)',
        plot_bgcolor='rgba(0,0,0,0)',
    )

    try:
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            img_bytes = fig.to_image(format="png", width=860, height=450, scale=2, engine="kaleido")
        return base64.b64encode(img_bytes).decode('utf-8')
    except Exception as e:
        logger.warning(f"BS Sankey chart failed: {e}")
        return _generate_balance_sheet_waterfall(stmt)


# ─── Fallback Matplotlib charts ────────────────────────────────────────────────

def _generate_pl_waterfall(stmt) -> str:
    """Proper bridge/waterfall P&L chart s červenými nákladovými barmi."""
    if not stmt:
        return ""
    revenue = getattr(stmt, 'mainActivityRevenue', None)
    gross = getattr(stmt, 'grossProfit', None)
    net = getattr(stmt, 'netProfitLoss', None)
    staff = getattr(stmt, 'staffCosts', None)
    depreciation = getattr(stmt, 'depreciation', None)
    interest = getattr(stmt, 'interestExpense', None)

    if revenue is None or revenue == 0:
        return ""

    def _fmt(v):
        """Formátuje číslo na skrátenú formu."""
        if abs(v) >= 1e9: return f'{v/1e9:.2f}B'
        if abs(v) >= 1e6: return f'{v/1e6:.1f}M'
        if abs(v) >= 1e3: return f'{v/1e3:.0f}k'
        return f'{v:.0f}'

    # Zostav kroky waterfall grafu
    # Každý krok: (label, delta, typ)
    # typ: 'total'    — plný bar od 0 (modrý/zelený/červený)
    #      'decrease' — klesajúci pruh (červený)
    #      'increase' — stúpajúci pruh (zelený)
    steps = []
    steps.append(('Tržby', revenue, 'total_blue'))

    if gross is not None:
        cogs = revenue - gross
        if cogs > 0:
            steps.append(('Priame nákl.\n(COGS)', -cogs, 'decrease'))
        steps.append(('Hrubá\nmarža', gross, 'subtotal'))

    if staff is not None and staff != 0:
        steps.append(('Osobné\nnáklady', -abs(staff), 'decrease'))
    if depreciation is not None and depreciation != 0:
        steps.append(('Odpisy', -abs(depreciation), 'decrease'))
    if interest is not None and interest != 0:
        steps.append(('Úroky', -abs(interest), 'decrease'))
    if net is not None:
        steps.append(('Čistý\nzisk', net, 'total_net'))

    if len(steps) < 3:
        return ""

    # Vypočítaj pozície barov (klasický bridge chart)
    bars = []   # (x, bottom, height, color, label, value_label)
    running = 0.0
    for i, (label, delta, typ) in enumerate(steps):
        if typ == 'total_blue':
            bars.append((i, 0, delta, '#1e40af', label, _fmt(delta)))
            running = delta
        elif typ == 'subtotal':
            bars.append((i, 0, delta, '#3b82f6', label, _fmt(delta)))
            running = delta
        elif typ == 'total_net':
            color = '#10b981' if delta >= 0 else '#ef4444'
            bars.append((i, 0, delta, color, label, _fmt(delta)))
            running = delta
        elif typ == 'decrease':
            # Červená plocha od (running + delta) po running
            bottom = running + delta
            height = abs(delta)
            bars.append((i, bottom, height, '#ef4444', label, _fmt(delta)))
            running += delta
        elif typ == 'increase':
            bars.append((i, running, delta, '#10b981', label, _fmt(delta)))
            running += delta

    # Kresli
    fig, ax = plt.subplots(figsize=(max(5.0, len(bars) * 0.95), 3.5))
    fig.patch.set_facecolor('white')
    ax.set_facecolor('white')

    max_val = max(b[1] + b[2] for b in bars)
    label_pad = max_val * 0.015

    for (x, bottom, height, color, label, val_label) in bars:
        # Bar
        ax.bar(x, height, bottom=bottom, color=color, width=0.6,
               edgecolor='white', linewidth=0.5, zorder=3)
        # Hodnota nad/pod barom
        top = bottom + height
        va = 'bottom' if top >= 0 else 'top'
        y_text = top + label_pad if top >= 0 else top - label_pad
        ax.text(x, y_text, val_label, ha='center', va=va,
                fontsize=8, color='#374151', fontweight='bold')
        # Spojovacia čiara (tenká šedá) pre bridge efekt
        if x > 0 and typ not in ('total_blue', 'total_net'):
            pass  # Matplotlib nemá natívny bridge connector, skip

    # X os
    ax.set_xticks(range(len(bars)))
    ax.set_xticklabels([b[4] for b in bars], fontsize=9, color='#374151',
                        multialignment='center')
    ax.tick_params(axis='y', labelsize=8, colors='#94a3b8')

    # Mriežka a os
    ax.yaxis.set_major_formatter(plt.FuncFormatter(
        lambda x, _: f'{x/1e9:.1f}B' if abs(x) >= 1e9
                    else (f'{x/1e6:.0f}M' if abs(x) >= 1e6 else f'{x/1e3:.0f}k')
    ))
    ax.grid(axis='y', alpha=0.15, color='#e2e8f0', zorder=0)
    ax.axhline(y=0, color='#94a3b8', linewidth=0.8, zorder=2)
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['left'].set_color('#e2e8f0')
    ax.spines['bottom'].set_color('#e2e8f0')
    ax.set_ylim(bottom=min(0, min(b[1] for b in bars)) - label_pad * 3)

    plt.tight_layout(pad=0.4)
    buf = io.BytesIO()
    fig.savefig(buf, format='png', dpi=150, bbox_inches='tight')
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode('utf-8')


def _generate_cashflow_waterfall(stmt) -> str:
    """Proper bridge/waterfall Cash Flow chart."""
    if not stmt:
        return ""
    net_profit = getattr(stmt, 'netProfitLoss', None)
    depreciation = getattr(stmt, 'depreciation', None)
    ocf = getattr(stmt, 'operatingCashFlow', None)

    if net_profit is None and ocf is None:
        return ""

    def _fmt(v):
        if abs(v) >= 1e9: return f'{v/1e9:.2f}B'
        if abs(v) >= 1e6: return f'{v/1e6:.1f}M'
        if abs(v) >= 1e3: return f'{v/1e3:.0f}k'
        return f'{v:.0f}'

    steps = []
    if net_profit is not None:
        steps.append(('Čistý\nzisk', net_profit, 'total_net'))
    
    if depreciation is not None and depreciation != 0:
        steps.append(('Odpisy', abs(depreciation), 'increase'))
    
    if net_profit is not None and depreciation is not None and ocf is not None:
        wc_change = ocf - (net_profit + abs(depreciation))
        if wc_change != 0:
            steps.append(('Zmeny\nv PK', wc_change, 'increase' if wc_change >= 0 else 'decrease'))

    if ocf is not None:
        steps.append(('Prevádz.\nCF', ocf, 'total_ocf'))

    if len(steps) < 2:
        return ""

    bars = []
    running = 0.0
    for i, (label, delta, typ) in enumerate(steps):
        if typ == 'total_net':
            color = '#10b981' if delta >= 0 else '#ef4444'
            bars.append((i, 0, delta, color, label, _fmt(delta)))
            running = delta
        elif typ == 'total_ocf':
            color = '#10b981' if delta >= 0 else '#ef4444'
            bars.append((i, 0, delta, color, label, _fmt(delta)))
            running = delta
        elif typ == 'decrease':
            bottom = running + delta
            height = abs(delta)
            bars.append((i, bottom, height, '#ef4444', label, _fmt(delta)))
            running += delta
        elif typ == 'increase':
            bars.append((i, running, delta, '#10b981', label, _fmt(delta)))
            running += delta

    fig, ax = plt.subplots(figsize=(max(4.0, len(bars) * 0.95), 3.5))
    fig.patch.set_facecolor('white')
    ax.set_facecolor('white')

    max_val = max(b[1] + b[2] for b in bars)
    label_pad = max_val * 0.015

    for (x, bottom, height, color, label, val_label) in bars:
        ax.bar(x, height, bottom=bottom, color=color, width=0.6,
               edgecolor='white', linewidth=0.5, zorder=3)
        top = bottom + height
        va = 'bottom' if top >= 0 else 'top'
        y_text = top + label_pad if top >= 0 else top - label_pad
        ax.text(x, y_text, val_label, ha='center', va=va,
                fontsize=8, color='#374151', fontweight='bold')

    ax.set_xticks(range(len(bars)))
    ax.set_xticklabels([b[4] for b in bars], fontsize=9, color='#374151', multialignment='center')
    ax.tick_params(axis='y', labelsize=8, colors='#94a3b8')

    ax.yaxis.set_major_formatter(plt.FuncFormatter(
        lambda x, _: f'{x/1e9:.1f}B' if abs(x) >= 1e9
                    else (f'{x/1e6:.0f}M' if abs(x) >= 1e6 else f'{x/1e3:.0f}k')
    ))
    ax.grid(axis='y', alpha=0.15, color='#e2e8f0', zorder=0)
    ax.axhline(y=0, color='#94a3b8', linewidth=0.8, zorder=2)
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['left'].set_color('#e2e8f0')
    ax.spines['bottom'].set_color('#e2e8f0')
    ax.set_ylim(bottom=min(0, min(b[1] for b in bars)) - label_pad * 3)

    plt.tight_layout(pad=0.4)
    buf = io.BytesIO()
    fig.savefig(buf, format='png', dpi=150, bbox_inches='tight')
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode('utf-8')


def _generate_balance_sheet_waterfall(stmt) -> str:
    if not stmt:
        return ""
    current = getattr(stmt, 'currentAssets', None) or 0
    inventory = getattr(stmt, 'inventory', None) or 0
    cash = getattr(stmt, 'cashAndEquivalents', None) or 0
    receivables = getattr(stmt, 'tradeReceivables', None) or 0
    total_assets = getattr(stmt, 'totalAssets', None) or 0
    equity = getattr(stmt, 'equity', None) or 0
    short_liab = getattr(stmt, 'shortTermLiabilities', None) or 0
    long_liab = getattr(stmt, 'longTermLiabilities', None) or 0

    if total_assets == 0:
        return ""
    non_current = total_assets - current

    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(6, 2.2))
    fig.patch.set_facecolor('white')

    asset_parts, asset_labels, asset_colors = [], [], []
    if non_current > 0:
        asset_parts.append(non_current)
        asset_labels.append(f'Dlhodobý majetok {non_current/total_assets*100:.0f}%')
        asset_colors.append('#1e40af')
    if inventory > 0:
        asset_parts.append(inventory)
        asset_labels.append(f'Zásoby {inventory/total_assets*100:.0f}%')
        asset_colors.append('#3b82f6')
    if receivables > 0:
        asset_parts.append(receivables)
        asset_labels.append(f'Pohľadávky {receivables/total_assets*100:.0f}%')
        asset_colors.append('#60a5fa')
    if cash > 0:
        asset_parts.append(cash)
        asset_labels.append(f'Hotovosť {cash/total_assets*100:.0f}%')
        asset_colors.append('#93c5fd')

    if asset_parts:
        ax1.barh(0, asset_parts[0], color=asset_colors[0], height=0.5, label=asset_labels[0])
        left = asset_parts[0]
        for i in range(1, len(asset_parts)):
            ax1.barh(0, asset_parts[i], left=left, color=asset_colors[i], height=0.5, label=asset_labels[i])
            left += asset_parts[i]

    ax1.set_xlim(0, total_assets); ax1.set_yticks([])
    ax1.set_title('Aktíva', fontsize=9, fontweight='bold', color='#475569', loc='left', pad=4)
    ax1.tick_params(axis='x', labelsize=8, colors='#94a3b8')
    ax1.xaxis.set_major_formatter(plt.FuncFormatter(
        lambda x, _: f'{x/1e9:.1f}B' if abs(x) >= 1e9 else (f'{x/1e6:.0f}M' if abs(x) >= 1e6 else f'{x/1e3:.0f}k')
    ))
    ax1.spines['top'].set_visible(False); ax1.spines['right'].set_visible(False)
    ax1.spines['left'].set_visible(False); ax1.spines['bottom'].set_color('#e2e8f0')
    ax1.legend(fontsize=7, loc='upper center', bbox_to_anchor=(0.5, -0.2), ncol=4, frameon=False)

    total_cap = equity + short_liab + long_liab
    if total_cap == 0:
        total_cap = total_assets

    cap_parts, cap_labels, cap_colors = [], [], []
    if equity != 0:
        pct = abs(equity) / abs(total_cap) * 100
        cap_parts.append(abs(equity))
        cap_labels.append(f'Vlastné imanie {"–" if equity < 0 else ""}{pct:.0f}%')
        cap_colors.append('#10b981' if equity > 0 else '#ef4444')
    if short_liab > 0:
        cap_parts.append(short_liab)
        cap_labels.append(f'Krátkodobé záväzky {short_liab/abs(total_cap)*100:.0f}%')
        cap_colors.append('#f59e0b')
    if long_liab > 0:
        cap_parts.append(long_liab)
        cap_labels.append(f'Dlhodobé záväzky {long_liab/abs(total_cap)*100:.0f}%')
        cap_colors.append('#ef4444')

    if cap_parts:
        ax2.barh(0, cap_parts[0], color=cap_colors[0], height=0.5, label=cap_labels[0])
        left = cap_parts[0]
        for i in range(1, len(cap_parts)):
            ax2.barh(0, cap_parts[i], left=left, color=cap_colors[i], height=0.5, label=cap_labels[i])
            left += cap_parts[i]

    ax2.set_xlim(0, abs(total_cap)); ax2.set_yticks([])
    ax2.set_title('Kapitál a záväzky', fontsize=9, fontweight='bold', color='#475569', loc='left', pad=4)
    ax2.tick_params(axis='x', labelsize=8, colors='#94a3b8')
    ax2.xaxis.set_major_formatter(plt.FuncFormatter(
        lambda x, _: f'{x/1e9:.1f}B' if abs(x) >= 1e9 else (f'{x/1e6:.0f}M' if abs(x) >= 1e6 else f'{x/1e3:.0f}k')
    ))
    ax2.spines['top'].set_visible(False); ax2.spines['right'].set_visible(False)
    ax2.spines['left'].set_visible(False); ax2.spines['bottom'].set_color('#e2e8f0')
    ax2.legend(fontsize=7, loc='upper center', bbox_to_anchor=(0.5, -0.2), ncol=3, frameon=False)

    plt.tight_layout(pad=0.3)
    buf = io.BytesIO()
    fig.savefig(buf, format='png', dpi=150, bbox_inches='tight')
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode('utf-8')
