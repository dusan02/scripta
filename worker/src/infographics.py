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

from src.i18n import get_i18n_strings

logger = logging.getLogger(__name__)


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
    if gross <= 0 or net < 0:
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
    node_x = [0.01, 0.5, 0.5, 0.99, 0.99, 0.99, 0.99, 0.99]
    node_y = [0.5, 0.2, 0.8, 0.1, 0.3, 0.5, 0.7, 0.9]

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
        font=dict(size=14, family='Inter, sans-serif', color='#0f172a'),
        margin=dict(l=20, r=20, t=20, b=20),
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

    fig = go.Figure(data=[go.Sankey(
        node=dict(
            pad=25,
            thickness=30,
            line=dict(color="white", width=1),
            label=labels,
            color=colors,
        ),
        link=dict(source=source, target=target, value=value, color=link_color),
    )])
    fig.update_layout(
        font=dict(size=14, family='Inter, sans-serif', color='#0f172a'),
        margin=dict(l=20, r=20, t=20, b=20),
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
        i.get('sankey_liabilities_other', 'Záväzky a iné'),    # 7
        i.get('sankey_equity', 'Vlastné imanie'),   # 8
        i.get('sankey_short_liab', 'Krátkodobé záv.'),  # 9
        i.get('sankey_long_liab', 'Dlhodobé záv.'),    # 10
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

    # Pridáme explicitné fixné súradnice, aby sme predišli prekríženiu
    # x=0 je vľavo, x=1 vpravo
    node_x = [0.01, 0.01, 0.01, 0.01, 0.25, 0.25, 0.5, 0.75, 0.99, 0.99, 0.99, 0.99]
    node_y = [0.1, 0.3, 0.5, 0.8, 0.25, 0.75, 0.5, 0.7, 0.2, 0.5, 0.7, 0.9]

    fig = go.Figure(data=[go.Sankey(
        arrangement="snap",
        node=dict(
            pad=20,
            thickness=22,
            line=dict(color="white", width=1),
            label=labels,
            color=colors,
            x=node_x,
            y=node_y,
        ),
        link=dict(source=source, target=target, value=value, color=link_color),
    )])
    fig.update_layout(
        font=dict(size=14, family='Inter, sans-serif', color='#0f172a'),
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
        return _generate_balance_sheet_waterfall(stmt, lang=lang)


# ─── Fallback Matplotlib charts ────────────────────────────────────────────────

def _to_base64(fig, width, height):
    try:
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            img_bytes = fig.to_image(format="png", width=width, height=height, scale=2, engine="kaleido")
        return base64.b64encode(img_bytes).decode('utf-8')
    except Exception as e:
        logger.warning(f"Plotly fallback chart failed: {e}")
        return ""

def _generate_pl_waterfall(stmt, lang="sk") -> str:
    """Proper bridge/waterfall P&L chart using Plotly."""
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
        steps.append({'name': i.get('sankey_gross_margin_short', 'Hrubá<br>marža'), 'measure': 'total'})

    if staff is not None and staff != 0:
        steps.append({'name': i.get('sankey_staff_short', 'Osobné<br>náklady'), 'measure': 'relative', 'y': -abs(staff)})
    if depreciation is not None and depreciation != 0:
        steps.append({'name': i.get('sankey_depreciation', 'Odpisy'), 'measure': 'relative', 'y': -abs(depreciation)})
    if interest is not None and interest != 0:
        steps.append({'name': i.get('sankey_interest', 'Úroky'), 'measure': 'relative', 'y': -abs(interest)})
    if net is not None:
        steps.append({'name': i.get('sankey_net_profit_short', 'Čistý<br>zisk'), 'measure': 'total'})

    if len(steps) < 3: return ""

    fig = go.Figure(go.Waterfall(
        orientation="v",
        measure=[s['measure'] for s in steps],
        x=[s['name'] for s in steps],
        y=[s.get('y', 0) for s in steps],
        connector={"line": {"color": "rgba(226,232,240,1)", "width": 1}},
        decreasing={"marker": {"color": "#ef4444"}},
        increasing={"marker": {"color": "#10b981"}},
        totals={"marker": {"color": "#1e40af"}},
        text=[f"{s.get('y', 0):.0f}" if s['measure'] != 'total' else "" for s in steps],
        textposition="outside",
        textfont=dict(size=12, color='#475569')
    ))

    fig.update_layout(
        title=dict(text=i.get('chart_pnl', 'Výkaz ziskov a strát'), font=dict(size=14, color='#0f172a')),
        plot_bgcolor='rgba(0,0,0,0)',
        paper_bgcolor='rgba(0,0,0,0)',
        margin=dict(l=40, r=20, t=50, b=30),
        xaxis=dict(showgrid=False, tickfont=dict(color='#64748b')),
        yaxis=dict(showgrid=True, gridcolor='#e2e8f0', zeroline=True, tickfont=dict(color='#64748b'))
    )
    return _to_base64(fig, 800, 350)


def _generate_cashflow_waterfall(stmt, lang="sk") -> str:
    """Proper bridge/waterfall Cash Flow chart using Plotly."""
    if not stmt: return ""
    i = get_i18n_strings(lang)
    net_profit = getattr(stmt, 'netProfitLoss', None)
    depreciation = getattr(stmt, 'depreciation', None)
    ocf = getattr(stmt, 'operatingCashFlow', None)
    if net_profit is None and ocf is None: return ""

    steps = []
    if net_profit is not None:
        steps.append({'name': i.get('sankey_net_profit_short', 'Čistý<br>zisk'), 'measure': 'absolute', 'y': net_profit})
    if depreciation is not None and depreciation != 0:
        steps.append({'name': i.get('sankey_depreciation', 'Odpisy'), 'measure': 'relative', 'y': abs(depreciation)})
    if net_profit is not None and depreciation is not None and ocf is not None:
        wc_change = ocf - (net_profit + abs(depreciation))
        if wc_change != 0:
            steps.append({'name': i.get('sankey_wc_short', 'Zmeny<br>v PK'), 'measure': 'relative', 'y': wc_change})
    if ocf is not None:
        steps.append({'name': i.get('sankey_operating_cf_short', 'Prevádz.<br>CF'), 'measure': 'total'})

    if len(steps) < 2: return ""

    fig = go.Figure(go.Waterfall(
        orientation="v",
        measure=[s['measure'] for s in steps],
        x=[s['name'] for s in steps],
        y=[s.get('y', 0) for s in steps],
        connector={"line": {"color": "rgba(226,232,240,1)", "width": 1}},
        decreasing={"marker": {"color": "#ef4444"}},
        increasing={"marker": {"color": "#10b981"}},
        totals={"marker": {"color": "#10b981" if ocf and ocf >= 0 else "#ef4444"}},
        text=[f"{s.get('y', 0):.0f}" if s['measure'] != 'total' else "" for s in steps],
        textposition="outside",
        textfont=dict(size=12, color='#475569')
    ))

    fig.update_layout(
        title=dict(text=i.get('sankey_operating_cf_title', 'Prevádzkový Cash Flow'), font=dict(size=14, color='#0f172a')),
        plot_bgcolor='rgba(0,0,0,0)',
        paper_bgcolor='rgba(0,0,0,0)',
        margin=dict(l=40, r=20, t=50, b=30),
        xaxis=dict(showgrid=False, tickfont=dict(color='#64748b')),
        yaxis=dict(showgrid=True, gridcolor='#e2e8f0', zeroline=True, tickfont=dict(color='#64748b'))
    )
    return _to_base64(fig, 800, 350)


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
