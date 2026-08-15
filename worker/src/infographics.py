import io
import base64
import logging
from decimal import Decimal
from types import SimpleNamespace

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
from src.plotly_charts import COLORS, _strip_kaleido_watermark

logger = logging.getLogger(__name__)


def _to_float(val):
    """Convert Decimal/None to float for matplotlib/plotly arithmetic."""
    if val is None:
        return None
    if isinstance(val, Decimal):
        return float(val)
    return val


# Numeric attributes on FinancialMetrics that may arrive as Decimal from Prisma
_NUMERIC_STMT_FIELDS = (
    "mainActivityRevenue", "grossProfit", "netProfitLoss", "staffCosts",
    "depreciation", "interestExpense", "incomeTax", "operatingCashFlow",
    "currentAssets", "inventory", "cashAndEquivalents", "tradeReceivables",
    "totalAssets", "equity", "shortTermLiabilities", "longTermLiabilities",
    "tradePayables", "year",
)


def _sanitize_stmt(stmt):
    """Return a copy of stmt with all numeric fields converted to float.

    Prisma's Decimal type causes TypeError when mixed with float in arithmetic
    (e.g. ``float - Decimal``). This helper ensures all numeric attributes are
    plain Python floats before they reach matplotlib/plotly.
    """
    if stmt is None:
        return None
    if isinstance(stmt, SimpleNamespace):
        # Already a mock — values are likely float/None, but sanitize anyway
        pass
    data = {}
    for field in _NUMERIC_STMT_FIELDS:
        val = getattr(stmt, field, None)
        if val is not None:
            val = _to_float(val)
        data[field] = val
    # Copy non-numeric attributes we might need
    for attr in ("statementType", "monthsInPeriod", "employeeCount", "auditorOpinion", "_gross_profit_estimated"):
        data[attr] = getattr(stmt, attr, None)
    return SimpleNamespace(**data)


def generate_pl_infographic(stmt, lang="sk") -> str:
    """Vygeneruje P&L Sankey diagram: Tržby → Hrubá marža → Čistý zisk."""
    if not stmt:
        return ""
    stmt = _sanitize_stmt(stmt)
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

    # Ak chýbajú kľúčové položky → waterfall
    if any(val is None for val in [gross, net, staff, depreciation, interest]):
        return _generate_pl_waterfall(stmt, lang=lang)
    if gross <= 0:
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

    # ── Korporátna paleta (inšpirovaná web verziou) ──────────────
    # Príjmy: modrá | Náklady: odlíšené farby | Zisk: zelená
    NODE_C = {
        'revenue':   COLORS['blue_dark'],   # Tržby
        'cogs':      '#f97316',             # Priame náklady - oranžová
        'gross':     COLORS['green'],       # Hrubá marža
        'staff':     '#ef4444',             # Osobné náklady - červená
        'depreciation': '#8b5cf6',          # Odpisy - fialová
        'interest':  '#eab308',             # Úroky - žltá
        'other_opex': '#ec4899',            # Ostatné náklady - ružová
        'net_profit': COLORS['green'],      # Čistý zisk
        'other_income': COLORS['blue'],     # Ostatné výnosy
        'loss':      COLORS['red'],         # Strata
        'other':     COLORS['slate_light'], # Ostatné (residual)
    }

    def _node_label(text: str, val: float) -> str:
        """Multi-line label s názvom a hodnotou (ako web verzia)."""
        return f"{text}<br><span style='font-size:11px;opacity:0.7'>{_adaptive_fmt(val)}</span>"

    labels = [
        _node_label(i.get('sankey_revenue', 'Tržby'), revenue),                        # 0
        _node_label(i.get('sankey_cogs', 'Priame náklady (COGS)'), cogs),              # 1
        _node_label(i.get('sankey_gross_margin', 'Hrubá marža'), gross),               # 2
        _node_label(i.get('sankey_staff', 'Osobné náklady'), staff_val),               # 3
        _node_label(i.get('sankey_depreciation', 'Odpisy'), dep_val),                  # 4
        _node_label(i.get('sankey_interest', 'Úroky'), int_val),                       # 5
        _node_label(i.get('sankey_other_opex', 'Ostatné prevádzkové náklady'), max(0, other_opex)),  # 6
        _node_label(i.get('sankey_net_profit', 'Čistý zisk'), max(0, net)),            # 7
    ]
    colors = [
        NODE_C['revenue'], NODE_C['cogs'], NODE_C['gross'],
        NODE_C['staff'], NODE_C['depreciation'], NODE_C['interest'], NODE_C['other_opex'],
        NODE_C['net_profit'],
    ]

    source, target, value, link_color = [], [], [], []

    # Tržby → COGS + Hrubá marža
    if cogs > 0:
        source.append(0); target.append(1); value.append(cogs)
        link_color.append("rgba(249,115,22,0.30)")  # oranžová (COGS)
    source.append(0); target.append(2); value.append(gross)
    link_color.append("rgba(91,146,121,0.35)")

    # Hrubá marža → náklady (odlíšené farby ako na webe)
    if staff_val > 0:
        source.append(2); target.append(3); value.append(staff_val)
        link_color.append("rgba(239,68,68,0.30)")  # červená (personál)
    if dep_val > 0:
        source.append(2); target.append(4); value.append(dep_val)
        link_color.append("rgba(139,92,246,0.30)")  # fialová (odpisy)
    if int_val > 0:
        source.append(2); target.append(5); value.append(int_val)
        link_color.append("rgba(234,179,8,0.30)")   # žltá (úroky)

    # other_opex: kladné = ostatné náklady odchádza z Hrubej marže
    #             záporné = ostatné výnosy pritekajú DO Hrubej marže (nový zdrojový uzol)
    if other_opex > 0:
        source.append(2); target.append(6); value.append(other_opex)
        link_color.append("rgba(236,72,153,0.35)")
    elif other_opex < 0:
        # Ostatné výnosy → Hrubá marža (index 2)
        labels.append(_node_label(i.get('sankey_other_income', 'Ostatné výnosy'), abs(other_opex)))
        colors.append(NODE_C['other_income'])
        idx_ov = len(labels) - 1
        source.append(idx_ov); target.append(2); value.append(abs(other_opex))
        link_color.append("rgba(59,130,246,0.35)")

    # Čistý zisk / Strata
    if net > 0:
        source.append(2); target.append(7); value.append(net)
        link_color.append("rgba(91,146,121,0.35)")
    elif net < 0:
        labels.append(_node_label(i.get('sankey_loss', 'Strata'), abs(net)))
        colors.append(NODE_C['loss'])
        idx_loss = len(labels) - 1
        source.append(idx_loss); target.append(2); value.append(abs(net))
        link_color.append("rgba(239,68,68,0.35)")

    # Sankey validácia: inflow do uzla 2 musí = outflow z uzla 2
    in_to_gross  = gross + (abs(other_opex) if other_opex < 0 else 0) + (abs(net) if net < 0 else 0)
    out_from_gross = sum(v for s, v in zip(source, value) if s == 2)
    tol = max(in_to_gross * 0.02, 1000)
    if abs(out_from_gross - in_to_gross) > tol:
        return _generate_pl_waterfall(stmt, lang=lang)

    # Explicitne definované orientačné súradnice pre uzly.
    # COGS a Hrubá marža sú umelo umiestnené do stredného stĺpca (x=0.5),
    # aby sa obrovské vlákno COGS netiahlo až na koniec a neprekrývalo ostatné.
    # Pravé uzly posunuté z 0.99 na 0.82 aby popisky nepretiekali za okraj.
    # Y rozsah 0.12–0.88 aby sa labely neodrezávali na okrajoch (boli 0.08–0.92).
    node_x = [0.01, 0.45, 0.45, 0.82, 0.82, 0.82, 0.82, 0.82]
    node_y = [0.50, 0.15, 0.75, 0.12, 0.32, 0.50, 0.68, 0.88]
    if net < 0:
        node_x.append(0.01)
        node_y.append(0.85)
    if other_opex < 0:
        node_x.append(0.01)
        node_y.append(0.20)

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
        font=dict(size=14, family=COLORS['font_family'], color=COLORS['text']),
        margin=dict(l=90, r=130, t=20, b=30),
        paper_bgcolor='rgba(0,0,0,0)',
        plot_bgcolor='rgba(0,0,0,0)',
    )

    try:
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            img_bytes = fig.to_image(format="png", width=1000, height=420, scale=2, engine="kaleido")
        img_bytes = _strip_kaleido_watermark(img_bytes)
        return base64.b64encode(img_bytes).decode('utf-8')
    except Exception as e:
        logger.warning(f"PL Sankey chart failed: {e}")
        return _generate_pl_waterfall(stmt, lang=lang)


def generate_cashflow_waterfall(stmt, lang="sk") -> str:
    """Vygeneruje Sankey graf rozkladenia cash flow."""
    if not stmt:
        return ""
    stmt = _sanitize_stmt(stmt)
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
        def _cf_lbl(text, val): return f"{text}<br><span style='font-size:11px;opacity:0.7'>{_adaptive_fmt(val)}</span>"
        labels = [
            _cf_lbl(i.get('sankey_net_profit', 'Čistý zisk'), net_profit),
            _cf_lbl(i.get('sankey_depreciation', 'Odpisy'), dep_val),
            _cf_lbl(i.get('sankey_wc_changes', 'Zmeny v prac. kapitále'), max(0, working_capital_effect)),
            _cf_lbl(i.get('chart_operating_cf', 'Prevádzkový CF'), ocf),
        ]
        colors = [COLORS['green'], '#8b5cf6', COLORS['green_light'], COLORS['green']]
        source = [0, 1]
        target = [3, 3]
        value = [net_profit, dep_val]
        link_color = ["rgba(91,146,121,0.35)", "rgba(139,92,246,0.35)"]
        node_x = [0.01, 0.01, 0.01, 0.82]
        node_y = [0.25, 0.60, 0.85, 0.50]
        if working_capital_effect > 0:
            source.append(2); target.append(3); value.append(working_capital_effect)
            link_color.append("rgba(34,197,94,0.35)")
    else:
        # BUG FIX: Záporný efekt PK. Schéma: 
        # Čistý zisk + Odpisy → Hrubý CF
        # Hrubý CF → Prevádzkový CF + Odtok do PK
        # Uzly: 0=Čistý zisk, 1=Odpisy, 2=Hrubý peňažný tok, 3=Prevádzkový CF, 4=Záporné zmeny v PK
        def _cf_lbl(text, val): return f"{text}<br><span style='font-size:11px;opacity:0.7'>{_adaptive_fmt(val)}</span>"
        labels = [
            _cf_lbl(i.get('sankey_net_profit', 'Čistý zisk'), net_profit),
            _cf_lbl(i.get('sankey_depreciation', 'Odpisy'), dep_val),
            _cf_lbl(i.get('sankey_gross_cf', 'Hrubý peňažný tok'), gross_cf),
            _cf_lbl(i.get('chart_operating_cf', 'Prevádzkový CF'), ocf),
            _cf_lbl(i.get('sankey_negative_wc', 'Záporné zmeny v prac. kapitále'), abs(working_capital_effect)),
        ]
        colors = [COLORS['green'], '#8b5cf6', "#1d4ed8", COLORS['green'], COLORS['red']]
        source = [0, 1, 2, 2]
        target = [2, 2, 3, 4]
        value = [net_profit, dep_val, ocf, abs(working_capital_effect)]
        link_color = [
            "rgba(91,146,121,0.35)", "rgba(139,92,246,0.35)",
            "rgba(91,146,121,0.35)", "rgba(239,68,68,0.35)"
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
        font=dict(size=14, family=COLORS['font_family'], color=COLORS['text']),
        margin=dict(l=90, r=130, t=20, b=30),
        paper_bgcolor='rgba(0,0,0,0)',
        plot_bgcolor='rgba(0,0,0,0)',
    )

    try:
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            img_bytes = fig.to_image(format="png", width=1000, height=400, scale=2, engine="kaleido")
        img_bytes = _strip_kaleido_watermark(img_bytes)
        return base64.b64encode(img_bytes).decode('utf-8')
    except Exception as e:
        logger.warning(f"CF Sankey chart failed: {e}")
        return _generate_cashflow_waterfall(stmt, lang=lang)


def generate_balance_sheet_infographic(stmt, lang="sk") -> str:
    """Vygeneruje Sankey infografiku štruktúry súvahy."""
    if not stmt:
        return ""
    stmt = _sanitize_stmt(stmt)
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

    equity_val = float(equity)
    is_negative_equity = equity_val < 0
    abs_equity = abs(equity_val)
    
    current_assets = max(0.0, float(current))
    non_current_assets = max(0.0, float(total_assets) - current_assets)
    
    short_term = max(0.0, float(short_liab))
    long_term = max(0.0, float(long_liab))
    
    # ── Korporátna paleta (zhodná s web verziou) ──────────────────
    BS_C = {
        'current':       '#06b6d4',   # Obežný majetok - tyrkysová
        'non_current':   '#0ea5e9',   # Neobežný majetok - modrá
        'equity':        '#059669',   # Vlastné imanie - zelená
        'short_liab':    '#64748b',   # Krátkodobé záväzky - slate
        'long_liab':     '#78716c',   # Dlhodobé záväzky - stone
        'neg_equity':    '#ef4444',   # Záporné imanie - červená
        'other':         '#94a3b8',   # Ostatné - slate light
        'cash':          '#10b981',   # Hotovosť - zelená light
        'receivables':   '#14b8a6',   # Pohľadávky - teal
        'inventory':     '#0ea5e9',   # Zásoby - modrá
        'other_current': '#94a3b8',   # Ostatné obežné - slate light
    }

    def _bs_label(text: str, val: float) -> str:
        """Multi-line label s názvom a hodnotou (ako web verzia)."""
        return f"{text}<br><span style='font-size:11px;opacity:0.7'>{_adaptive_fmt(val)}</span>"

    def _bs_link_color(hex_color: str, alpha: float = 0.30) -> str:
        """Convert hex color to rgba string."""
        h = hex_color.lstrip('#')
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        return f"rgba({r},{g},{b},{alpha})"

    # Ľavé uzly (Aktíva + záporné VI)
    left_nodes = []
    if current_assets > 0:
        left_nodes.append({"name": _bs_label(i.get('sankey_current_assets', 'Obežný majetok'), current_assets), "value": current_assets, "color": BS_C['current'], "link_color": _bs_link_color(BS_C['current']), "id": 4})
    if non_current_assets > 0:
        left_nodes.append({"name": _bs_label(i.get('sankey_non_current', 'Dlhodobý majetok'), non_current_assets), "value": non_current_assets, "color": BS_C['non_current'], "link_color": _bs_link_color(BS_C['non_current']), "id": 5})
    if is_negative_equity and abs_equity > 0:
        left_nodes.append({"name": _bs_label(i.get('sankey_negative_equity', 'Záporné vl. imanie'), abs_equity), "value": abs_equity, "color": BS_C['neg_equity'], "link_color": _bs_link_color(BS_C['neg_equity']), "id": 99})
        
    # Pravé uzly (Pasíva)
    right_nodes = []
    if not is_negative_equity and abs_equity > 0:
        right_nodes.append({"name": _bs_label(i.get('sankey_equity', 'Vlastné imanie'), abs_equity), "value": abs_equity, "color": BS_C['equity'], "link_color": _bs_link_color(BS_C['equity']), "id": 8})
    if short_term > 0:
        right_nodes.append({"name": _bs_label(i.get('sankey_short_liab', 'Krátkodobé záväzky'), short_term), "value": short_term, "color": BS_C['short_liab'], "link_color": _bs_link_color(BS_C['short_liab']), "id": 9})
    if long_term > 0:
        right_nodes.append({"name": _bs_label(i.get('sankey_long_liab', 'Dlhodobé záväzky'), long_term), "value": long_term, "color": BS_C['long_liab'], "link_color": _bs_link_color(BS_C['long_liab']), "id": 10})
        
    left_sum = sum(n["value"] for n in left_nodes)
    right_sum = sum(n["value"] for n in right_nodes)
    center_val = max(left_sum, right_sum, float(total_assets))
    
    if left_sum < center_val:
        residual = center_val - left_sum
        left_nodes.append({"name": _bs_label(i.get('sankey_other_active', 'Ostatné aktíva'), residual), "value": residual, "color": BS_C['other'], "link_color": _bs_link_color(BS_C['other'], 0.25), "id": 100})
    if right_sum < center_val:
        residual = center_val - right_sum
        right_nodes.append({"name": _bs_label(i.get('sankey_other_pasiva', 'Ostatné pasíva'), residual), "value": residual, "color": BS_C['other'], "link_color": _bs_link_color(BS_C['other'], 0.25), "id": 11})

    # Sub-nodes for current assets
    raw_components = cash + receivables + inventory
    if raw_components > current_assets and raw_components > 0:
        scale = current_assets / raw_components
        cash, receivables, inventory = cash * scale, receivables * scale, inventory * scale
        other_current = 0.0
    elif raw_components == 0 and current_assets > 0:
        other_current = current_assets
    else:
        other_current = max(0.0, current_assets - raw_components)

    nodes = []
    links = []
    node_x, node_y = [], []
    
    # Pridanie sub-nodes — Y rozsah 0.12–0.85, rovnomerne rozmiestnené
    sub_nodes_start = len(nodes)
    if cash > 0: nodes.append({"name": _bs_label(i.get('sankey_cash', 'Hotovosť'), cash), "color": BS_C['cash']}); node_x.append(0.01); node_y.append(0.12)
    if receivables > 0: nodes.append({"name": _bs_label(i.get('sankey_receivables', 'Pohľadávky'), receivables), "color": BS_C['receivables']}); node_x.append(0.01); node_y.append(0.33)
    if inventory > 0: nodes.append({"name": _bs_label(i.get('sankey_inventory', 'Zásoby'), inventory), "color": BS_C['inventory']}); node_x.append(0.01); node_y.append(0.54)
    if other_current > 0: nodes.append({"name": _bs_label(i.get('sankey_other_current', 'Ostat. obež. maj.'), other_current), "color": BS_C['other_current']}); node_x.append(0.01); node_y.append(0.82)
    
    # Mapovanie Left nodes — Y rozsah 0.12–0.82, rovnomerne
    left_count = len(left_nodes)
    left_node_ids = {}
    for i_node, n in enumerate(left_nodes):
        nodes.append({"name": n["name"], "color": n["color"]})
        node_x.append(0.25)
        if left_count <= 1:
            node_y.append(0.50)
        else:
            node_y.append(0.12 + (i_node * (0.70 / (left_count - 1))))
        left_node_ids[n["id"]] = len(nodes) - 1
        
    # Prepojenie sub-nodes do Obežného majetku (id: 4)
    if 4 in left_node_ids:
        om_idx = left_node_ids[4]
        idx = sub_nodes_start
        if cash > 0: links.append({"source": idx, "target": om_idx, "value": cash, "color": _bs_link_color(BS_C['cash'], 0.25)}); idx += 1
        if receivables > 0: links.append({"source": idx, "target": om_idx, "value": receivables, "color": _bs_link_color(BS_C['receivables'], 0.25)}); idx += 1
        if inventory > 0: links.append({"source": idx, "target": om_idx, "value": inventory, "color": _bs_link_color(BS_C['inventory'], 0.25)}); idx += 1
        if other_current > 0: links.append({"source": idx, "target": om_idx, "value": other_current, "color": _bs_link_color(BS_C['other_current'], 0.25)})
        
    # Center node
    center_idx = len(nodes)
    nodes.append({"name": _bs_label(i.get('sankey_total_assets', 'Celkové aktíva'), center_val), "color": COLORS['slate']})
    node_x.append(0.5)
    node_y.append(0.5)
    
    # Prepojenie Left nodes do Center node
    for n in left_nodes:
        idx = left_node_ids[n["id"]]
        links.append({"source": idx, "target": center_idx, "value": n["value"], "color": n["link_color"]})
        
    # Right nodes — Y rozsah 0.12–0.85, rovnomerne
    right_count = len(right_nodes)
    for i_node, n in enumerate(right_nodes):
        nodes.append({"name": n["name"], "color": n["color"]})
        node_x.append(0.85)
        if right_count <= 1:
            node_y.append(0.50)
        else:
            node_y.append(0.12 + (i_node * (0.73 / (right_count - 1))))
        idx = len(nodes) - 1
        links.append({"source": center_idx, "target": idx, "value": n["value"], "color": n["link_color"]})

    labels = [n["name"] for n in nodes]
    colors = [n["color"] for n in nodes]
    
    source = [l["source"] for l in links]
    target = [l["target"] for l in links]
    value = [l["value"] for l in links]
    link_color = [l["color"] for l in links]

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
        font=dict(size=14, family=COLORS['font_family'], color=COLORS['text']),
        margin=dict(l=90, r=140, t=20, b=40),
        paper_bgcolor='rgba(0,0,0,0)',
        plot_bgcolor='rgba(0,0,0,0)',
    )

    try:
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            img_bytes = fig.to_image(format="png", width=1000, height=460, scale=2, engine="kaleido")
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
                bar_colors.append(COLORS['green'])
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

    fig, ax = plt.subplots(figsize=(8, 4), dpi=150)
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

    # Connector lines between bars (dashed line from top of current bar
    # to the base of the next bar, showing the cascade flow)
    for idx in range(n - 1):
        cur = steps[idx]
        cur_val = cur.get('y', 0)
        if cur['measure'] == 'absolute':
            connector_y = cur_val
        elif cur['measure'] == 'relative':
            connector_y = bar_base[idx] if cur_val < 0 else bar_base[idx] + bar_y[idx]
        elif cur['measure'] == 'total':
            connector_y = bar_base[idx] + bar_y[idx] if bar_y[idx] >= 0 else bar_base[idx]
        else:
            continue
        ax.plot([idx + 0.3, idx + 0.7], [connector_y, connector_y],
                color='#94a3b8', linewidth=0.8, linestyle='--')

    ax.set_xticks(x_pos)
    ax.set_xticklabels(x_labels, fontsize=8, color='#64748b', rotation=30, ha='right')
    ax.set_title(title, fontsize=13, color='#0f172a', fontweight='bold', pad=10)
    ax.tick_params(axis='y', labelsize=9, colors='#64748b')
    from matplotlib.ticker import FuncFormatter
    _max_abs = max(abs(v) for v in bar_y) if bar_y else 0
    if _max_abs >= 1_000_000:
        ax.yaxis.set_major_formatter(FuncFormatter(lambda x, _: f'{x/1e6:.1f}M'))
    elif _max_abs >= 10_000:
        ax.yaxis.set_major_formatter(FuncFormatter(lambda x, _: f'{x/1e3:.0f}k'))
    elif _max_abs >= 1_000:
        ax.yaxis.set_major_formatter(FuncFormatter(lambda x, _: f'{x/1e3:.1f}k'))
    else:
        ax.yaxis.set_major_formatter(FuncFormatter(lambda x, _: f'{x:.0f}'))
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
    stmt = _sanitize_stmt(stmt)
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
    if gross is not None and gross != 0:
        cogs = revenue - gross
        if cogs > 0:
            steps.append({'name': 'COGS', 'measure': 'relative', 'y': -cogs})
        steps.append({'name': i.get('sankey_gross_margin_short', 'Hrubá marža'), 'measure': 'total'})
    else:
        # No gross profit data — add a total step as anchor so subsequent
        # costs cascade properly instead of hanging in the air
        steps.append({'name': i.get('sankey_gross_margin_short', 'Hrubá marža'), 'measure': 'total'})

    if staff is not None and staff != 0:
        steps.append({'name': i.get('sankey_staff_short', 'Osobné náklady'), 'measure': 'relative', 'y': -abs(staff)})
    if depreciation is not None and depreciation != 0:
        steps.append({'name': i.get('sankey_depreciation', 'Odpisy'), 'measure': 'relative', 'y': -abs(depreciation)})
    if interest is not None and interest != 0:
        steps.append({'name': i.get('sankey_interest', 'Úroky'), 'measure': 'relative', 'y': -abs(interest)})

    # Bridge step: "Other operating income/expenses" — rozdiel medzi
    # gross - staff - dep - interest a net profit. Môže byť kladný (náklady)
    # alebo záporný (výnosy). Bez tohto kroku waterfall matematika nesedí.
    if gross is not None and net is not None:
        known_costs = abs(staff or 0) + abs(depreciation or 0) + abs(interest or 0)
        other_opex = gross - net - known_costs
        if abs(other_opex) > max(abs(revenue) * 0.001, 100):
            if other_opex > 0:
                steps.append({'name': i.get('sankey_other_opex', 'Ostatné náklady'), 'measure': 'relative', 'y': -other_opex})
            else:
                steps.append({'name': i.get('sankey_other_income', 'Ostatné výnosy'), 'measure': 'relative', 'y': abs(other_opex)})

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
    stmt = _sanitize_stmt(stmt)
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
    stmt = _sanitize_stmt(stmt)
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
    colors_a = [COLORS['blue_dark'], COLORS['blue'], COLORS['blue_light'], '#93c5fd']
    
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
    colors_c = [COLORS['green'] if equity > 0 else COLORS['red'], COLORS['amber'], COLORS['red']]
    
    for l, v, c in zip(labels_c, values_c, colors_c):
        if v > 0:
            name = f"{l} ({v/abs(total_cap)*100:.0f}%)"
            fig.add_trace(go.Bar(
                y=[i.get('sankey_pasiva', 'Pasíva')], x=[v], name=name, orientation='h', marker_color=c,
                text=f"{v/abs(total_cap)*100:.0f}%", textposition='inside', insidetextanchor='middle'
            ))

    fig.update_layout(
        barmode='stack',
        title=dict(text=i.get('chart_balance_structure', 'Štruktúra majetku a zdrojov'), font=dict(size=14, color=COLORS['text'], family=COLORS['font_family'])),
        plot_bgcolor='rgba(0,0,0,0)',
        paper_bgcolor='rgba(0,0,0,0)',
        margin=dict(l=80, r=20, t=50, b=100),
        legend=dict(orientation="h", yanchor="top", y=-0.1, xanchor="center", x=0.5, font=dict(size=10, color=COLORS['text_light'])),
        xaxis=dict(showgrid=True, gridcolor=COLORS['grid'], zeroline=True, tickfont=dict(color=COLORS['text_muted'])),
        yaxis=dict(showgrid=False, tickfont=dict(size=12, color=COLORS['text'], weight='bold'))
    )
    return _to_base64(fig, 800, 300)
