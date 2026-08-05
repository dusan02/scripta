import io
import base64
import logging
from decimal import Decimal
import plotly.graph_objects as go
import plotly.express as px
import numpy as np

from src.i18n import get_i18n_strings

logger = logging.getLogger(__name__)


def _to_float(val):
    """Convert Decimal/None to float for plotly arithmetic."""
    if val is None:
        return 0.0
    if isinstance(val, Decimal):
        return float(val)
    return val

# ─── Unified color palette ───────────────────────────────────────────────────
COLORS = {
    'green':       '#10b981',
    'green_light': '#34d399',
    'red':         '#ef4444',
    'red_light':   '#fca5a5',
    'amber':       '#f59e0b',
    'blue':        '#3b82f6',
    'blue_dark':   '#1e40af',
    'blue_light':  '#60a5fa',
    'slate':       '#1e293b',
    'slate_light': '#94a3b8',
    'grid':        '#e2e8f0',
    'zero_line':   '#cbd5e1',
    'text':        '#0f172a',
    'text_muted':  '#64748b',
    'text_light':  '#475569',
    'font_family': 'Inter, Arial, sans-serif',
}

def _fmt_currency(x):
    if abs(x) >= 1e6: return f'{x/1e6:.1f}M'
    if abs(x) >= 1e3: return f'{x/1e3:.0f}k'
    return f'{x:.0f}'


def _sanitize_value(val):
    """Replace NaN/Infinity/None/invalid with 0.0 for safe chart rendering."""
    import math
    if val is None:
        return 0.0
    try:
        f = float(val)
    except (ValueError, TypeError):
        logger.warning(f"Non-numeric value sanitized: {val!r}")
        return 0.0
    if not math.isfinite(f):
        logger.warning(f"Non-finite value sanitized: {val}")
        return 0.0
    return f

def _prepare_statements(statements):
    from datetime import datetime
    from types import SimpleNamespace
    current_year = datetime.now().year
    seen_years = set()
    valid_stmts = []
    for s in statements:
        try:
            y = int(s.year)
            if y <= current_year and y not in seen_years:
                s.year = y
                valid_stmts.append(s)
                seen_years.add(y)
        except (ValueError, TypeError):
            continue
    valid_stmts.sort(key=lambda x: x.year)
    # Sanitizácia: konverzia Decimal na float (po migrácii Float→Decimal v DB)
    # Všetky chart funkcie robia aritmetiku s týmito hodnotami — Decimal + float = TypeError
    return [_sanitize_stmt(s) for s in valid_stmts]


# Numeric fields that may arrive as Decimal from Prisma after Float→Decimal migration
_NUMERIC_CHART_FIELDS = (
    "mainActivityRevenue", "grossProfit", "netProfitLoss", "staffCosts",
    "depreciation", "interestExpense", "operatingCashFlow",
    "investingCashFlow", "financingCashFlow",
    "currentAssets", "inventory", "cashAndEquivalents", "tradeReceivables",
    "totalAssets", "equity", "shortTermLiabilities", "longTermLiabilities",
    "tradePayables", "year", "employeeCount", "monthsInPeriod",
)


def _sanitize_stmt(stmt):
    """Return a copy of stmt with all numeric fields converted to float.

    Prisma's Decimal type causes TypeError when mixed with float in arithmetic
    (e.g. ``float - Decimal``). This helper ensures all numeric attributes are
    plain Python floats before they reach plotly chart functions.
    """
    from types import SimpleNamespace
    if stmt is None:
        return None
    data = {}
    for field in _NUMERIC_CHART_FIELDS:
        val = getattr(stmt, field, None)
        if val is not None:
            val = _to_float(val)
        data[field] = val
    # Copy non-numeric attributes we might need
    for attr in ("statementType", "isConsolidated", "auditorOpinion", "narrativeRisk", "notesRisk", "_gross_profit_estimated"):
        data[attr] = getattr(stmt, attr, None)
    return SimpleNamespace(**data)

def get_base_layout(title):
    return dict(
        title=dict(text=title, font=dict(size=14, color=COLORS['text'], family=COLORS['font_family'])),
        plot_bgcolor='rgba(0,0,0,0)',
        paper_bgcolor='rgba(0,0,0,0)',
        margin=dict(l=40, r=40, t=50, b=45),
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1, font=dict(size=10, color=COLORS['text_light'])),
        xaxis=dict(type='category', categoryorder='category ascending', showgrid=False, showline=True, linecolor=COLORS['grid'], tickfont=dict(color=COLORS['text_muted'], size=11, family=COLORS['font_family']), tickangle=-30, automargin=True, tickformat=''),
        yaxis=dict(showgrid=True, gridcolor=COLORS['grid'], zeroline=True, zerolinecolor=COLORS['zero_line'], tickfont=dict(color=COLORS['text_muted']))
    )

def _strip_kaleido_watermark(img_bytes: bytes) -> bytes:
    """Remove Kaleido 0.2.x 'Humanity ex' watermark from bottom of image."""
    try:
        from PIL import Image
        import io as _io
        img = Image.open(_io.BytesIO(img_bytes))
        w, h = img.size
        cropped = img.crop((0, 0, w, int(h * 0.97)))
        buf = _io.BytesIO()
        cropped.save(buf, format='PNG')
        return buf.getvalue()
    except Exception:
        return img_bytes

def _to_base64(fig, width=1000, height=450):
    try:
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            img_bytes = fig.to_image(format="png", width=width, height=height, scale=2)
        img_bytes = _strip_kaleido_watermark(img_bytes)
        return base64.b64encode(img_bytes).decode('utf-8')
    except Exception as e:
        logger.error(f"Plotly render error: {e}", exc_info=True)
        return ""

def generate_financial_chart(statements, lang="sk") -> str:
    if not statements or len(statements) < 2: return ""
    i = get_i18n_strings(lang)
    statements = _prepare_statements(statements)
    years = [str(s.year) for s in statements]
    revenues = [_sanitize_value(s.mainActivityRevenue) for s in statements]
    profits = [_sanitize_value(s.netProfitLoss) for s in statements]

    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=years, y=revenues, name=i.get('chart_revenue', 'Tržby'), mode='lines+markers',
        line=dict(color='#1e293b', width=3, shape='spline'), marker=dict(size=8, color='#1e293b')
    ))
    color = '#10b981' if sum(profits) >= 0 else '#ef4444'
    fillcolor = 'rgba(16,185,129,0.1)' if sum(profits) >= 0 else 'rgba(239,68,68,0.1)'
    fig.add_trace(go.Scatter(
        x=years, y=profits, name=i.get('chart_net_profit_loss', 'Čistý Zisk / Strata'), mode='lines+markers',
        fill='tozeroy', fillcolor=fillcolor,
        line=dict(color=color, width=3, shape='spline'), marker=dict(size=8)
    ))

    layout = get_base_layout(i.get('chart_revenue_profit', 'Vývoj Tržieb a Zisku'))
    fig.update_layout(**layout)
    return _to_base64(fig, 800, 400)

def generate_balance_sheet_chart(statements, lang="sk") -> str:
    if not statements or len(statements) < 2: return ""
    i = get_i18n_strings(lang)
    statements = _prepare_statements(statements)
    years = [str(s.year) for s in statements]
    assets = [_sanitize_value(s.totalAssets) for s in statements]
    equity = [_sanitize_value(s.equity) for s in statements]
    debt = [(_sanitize_value(s.shortTermLiabilities) + _sanitize_value(s.longTermLiabilities)) for s in statements]

    fig = go.Figure()
    other_pasiva = []
    for s in statements:
        ta = _sanitize_value(s.totalAssets)
        eq = max(0, _sanitize_value(s.equity))
        sl = _sanitize_value(s.shortTermLiabilities)
        ll = _sanitize_value(s.longTermLiabilities)
        other_pasiva.append(max(0, ta - eq - sl - ll))

    fig.add_trace(go.Scatter(
        x=years, y=assets, name=i.get('chart_total_assets', 'Celkové Aktíva'), mode='lines+markers',
        line=dict(color=COLORS['slate_light'], width=2, dash='dash'), marker=dict(size=7)
    ))
    fig.add_trace(go.Scatter(
        x=years, y=debt, name=i.get('chart_total_debt', 'Celkový Dlh'), mode='lines+markers',
        line=dict(color=COLORS['red'], width=3, shape='spline'), marker=dict(size=8, symbol='triangle-up')
    ))
    fig.add_trace(go.Scatter(
        x=years, y=equity, name=i.get('chart_equity', 'Vlastné Imanie'), mode='lines+markers',
        line=dict(color=COLORS['green'], width=3, shape='spline'), marker=dict(size=8, symbol='square')
    ))
    if any(v > 0 for v in other_pasiva):
        fig.add_trace(go.Scatter(
            x=years, y=other_pasiva, name=i.get('sankey_other_pasiva', 'Ostatné pasíva'), mode='lines+markers',
            line=dict(color=COLORS['amber'], width=2, dash='dot'), marker=dict(size=6, symbol='cross')
        ))

    layout = get_base_layout(i.get('chart_balance_structure', 'Štruktúra majetku a zdrojov'))
    fig.update_layout(**layout)
    return _to_base64(fig, 800, 400)

def generate_pnl_chart(statements, lang="sk") -> str:
    if not statements or len(statements) < 2: return ""
    i = get_i18n_strings(lang)
    statements = _prepare_statements(statements)
    years = [str(s.year) for s in statements]
    revenues = [_sanitize_value(s.mainActivityRevenue) for s in statements]
    gross = [_sanitize_value(s.grossProfit) for s in statements]
    ebitda = [_sanitize_value(s.netProfitLoss) + abs(_sanitize_value(s.interestExpense)) + _sanitize_value(s.depreciation) for s in statements]
    net = [_sanitize_value(s.netProfitLoss) for s in statements]

    fig = go.Figure()
    fig.add_trace(go.Bar(x=years, y=revenues, name=i.get('chart_revenue', 'Tržby'), marker_color=COLORS['slate']))
    fig.add_trace(go.Bar(x=years, y=gross, name=i.get('chart_gross_margin', 'Hrubá marža'), marker_color=COLORS['blue']))
    ebitda_colors = [COLORS['amber'] if v >= 0 else COLORS['red'] for v in ebitda]
    fig.add_trace(go.Bar(x=years, y=ebitda, name='EBITDA', marker_color=ebitda_colors))
    net_colors = [COLORS['green'] if v >= 0 else COLORS['red'] for v in net]
    fig.add_trace(go.Bar(x=years, y=net, name=i.get('chart_net_profit', 'Čistý zisk'), marker_color=net_colors))

    layout = get_base_layout(i.get('chart_pnl', 'Výkaz ziskov a strát'))
    layout['barmode'] = 'group'
    layout['bargap'] = 0.15
    layout['bargroupgap'] = 0.1
    layout['margin'] = dict(l=50, r=40, t=55, b=55)
    layout['yaxis']['automargin'] = True
    fig.update_layout(**layout)
    return _to_base64(fig, 800, 450)

def generate_cashflow_chart(statements, lang="sk") -> str:
    if not statements or len(statements) < 2: return ""
    i = get_i18n_strings(lang)
    statements = _prepare_statements(statements)
    years = [str(s.year) for s in statements]
    ocf_raw = [s.operatingCashFlow for s in statements]
    if all(v is None or v == 0 for v in ocf_raw): return ""
    ocf = [_sanitize_value(v) for v in ocf_raw]
    icf = [_sanitize_value(s.investingCashFlow) for s in statements]
    fcf = [_sanitize_value(s.financingCashFlow) for s in statements]
    cash = [_sanitize_value(s.cashAndEquivalents) for s in statements]

    fig = go.Figure()
    fig.add_trace(go.Bar(x=years, y=ocf, name=i.get('chart_operating_cf', 'Prevádzkový CF'), marker_color=COLORS['green']))
    fig.add_trace(go.Bar(x=years, y=icf, name=i.get('chart_investing_cf', 'Investičný CF'), marker_color=COLORS['red']))
    fig.add_trace(go.Bar(x=years, y=fcf, name=i.get('chart_financing_cf', 'Finančný CF'), marker_color=COLORS['blue']))
    
    fig.add_trace(go.Scatter(
        x=years, y=cash, name=i.get('chart_cash_equivalents', 'Cash & ekvivalenty'), mode='lines+markers',
        line=dict(color=COLORS['slate'], width=2, dash='dash'), marker=dict(size=8, symbol='diamond')
    ))

    layout = get_base_layout(i.get('chart_cashflow_liquidity', 'Peňažné toky a likvidita'))
    layout['barmode'] = 'relative'
    fig.update_layout(**layout)
    return _to_base64(fig, 800, 350)

def generate_liquidity_chart(statements, lang="sk") -> str:
    if not statements or len(statements) < 2: return ""
    i = get_i18n_strings(lang)
    statements = _prepare_statements(statements)
    years = [str(s.year) for s in statements]
    wc = [(_sanitize_value(s.currentAssets)) - (_sanitize_value(s.shortTermLiabilities)) for s in statements]
    cr = []
    qr = []
    for s in statements:
        stl = _sanitize_value(s.shortTermLiabilities)
        ca = _sanitize_value(s.currentAssets)
        inv = _sanitize_value(s.inventory)
        if stl > 0:
            cr.append(ca / stl)
            qr.append((ca - inv) / stl)
        else:
            cr.append(None)
            qr.append(None)

    from plotly.subplots import make_subplots
    fig = make_subplots(specs=[[{"secondary_y": True}]])
    
    fig.add_trace(go.Bar(x=years, y=wc, name=i.get('chart_working_capital', 'Pracovný kapitál'), marker_color='rgba(148,163,184,0.6)'), secondary_y=False)
    cr_text = [f'{v:.2f}' if v is not None else '' for v in cr]
    qr_text = [f'{v:.2f}' if v is not None else '' for v in qr]
    fig.add_trace(go.Scatter(x=years, y=cr, name=i.get('liq_current', 'Current Ratio'), mode='lines+markers+text', line=dict(color=COLORS['blue'], width=2), marker=dict(size=7), text=cr_text, textposition='top center', textfont=dict(size=9, color=COLORS['blue']), connectgaps=True), secondary_y=True)
    fig.add_trace(go.Scatter(x=years, y=qr, name=i.get('liq_quick', 'Quick Ratio'), mode='lines+markers+text', line=dict(color=COLORS['green'], width=2), marker=dict(size=7, symbol='diamond'), text=qr_text, textposition='bottom center', textfont=dict(size=9, color=COLORS['green']), connectgaps=True), secondary_y=True)
    
    # 1.0 threshold line
    fig.add_hline(y=1.0, line_dash="dash", line_color="rgba(239,68,68,0.5)", secondary_y=True)

    layout = get_base_layout(i.get('chart_liquidity_wc', 'Likvidita a Pracovný kapitál'))
    layout['yaxis'] = dict(showgrid=False, zeroline=True, zerolinecolor=COLORS['zero_line'])
    layout['yaxis2'] = dict(showgrid=True, gridcolor=COLORS['grid'], zeroline=False)
    fig.update_layout(**layout)
    return _to_base64(fig, 600, 300)

def generate_altman_chart(altman_scores, lang="sk") -> str:
    if not altman_scores or len(altman_scores) < 2: return ""
    valid = [z for z in altman_scores if z.get("z_score") is not None]
    if len(valid) < 2: return ""
    valid = sorted(valid, key=lambda z: z["year"])
    years = [str(z["year"]) for z in valid]
    scores = [z["z_score"] for z in valid]

    fig = go.Figure()
    
    max_y = max(scores) * 1.2 if max(scores) > 2.6 else 4.0
    min_y = min(scores) - 0.5 if min(scores) < 0 else 0
    
    # Add colored zones (Distress, Grey, Safe)
    fig.add_hrect(y0=min_y, y1=1.1, fillcolor="#ef4444", opacity=0.1, line_width=0)
    fig.add_hrect(y0=1.1, y1=2.6, fillcolor="#f59e0b", opacity=0.1, line_width=0)
    fig.add_hrect(y0=2.6, y1=max_y, fillcolor="#10b981", opacity=0.1, line_width=0)
    
    # Threshold lines
    fig.add_hline(y=1.1, line_dash="dash", line_color="rgba(239,68,68,0.5)")
    fig.add_hline(y=2.6, line_dash="dash", line_color="rgba(16,185,129,0.5)")

    colors = [COLORS['green'] if s > 2.6 else COLORS['amber'] if s >= 1.1 else COLORS['red'] for s in scores]
    
    fig.add_trace(go.Scatter(
        x=years, y=scores, name='Z-Score', mode='lines+markers+text',
        text=[f"{s:.2f}" for s in scores],
        textposition="top center",
        textfont=dict(color=colors, size=14, family=COLORS['font_family'], weight='bold'),
        line=dict(color=COLORS['slate'], width=2),
        marker=dict(size=12, color=colors, line=dict(color='#ffffff', width=2))
    ))

    layout = get_base_layout(get_i18n_strings(lang).get('chart_altman_trend', 'Altman Z\'\'-Score trend'))
    layout['yaxis'].update(range=[min_y, max_y])
    layout['showlegend'] = False
    fig.update_layout(**layout)
    return _to_base64(fig, 600, 300)

def generate_ratios_trend_chart(trend_ratios: list, lang="sk") -> str:
    if not trend_ratios or len(trend_ratios) < 2: return ""
    i = get_i18n_strings(lang)
    years = [str(t["year"]) for t in trend_ratios]
    roa = [t.get("roa_pct") for t in trend_ratios]
    roe = [t.get("roe_pct") for t in trend_ratios]
    margin = [t.get("net_profit_margin_pct") for t in trend_ratios]

    fig = go.Figure()
    fig.add_trace(go.Scatter(x=years, y=roa, name='ROA', mode='lines+markers', line=dict(color=COLORS['green'], width=3), marker=dict(size=8)))
    fig.add_trace(go.Scatter(x=years, y=roe, name='ROE', mode='lines+markers', line=dict(color=COLORS['blue'], width=3), marker=dict(size=8)))
    fig.add_trace(go.Scatter(x=years, y=margin, name=i.get('chart_net_margin', 'Čistá marža'), mode='lines+markers', line=dict(color=COLORS['amber'], width=3), marker=dict(size=8)))

    fig.add_hline(y=0, line_dash="dash", line_color=COLORS['zero_line'])
    layout = get_base_layout(i.get('chart_ratios_trend', 'Trend rentability'))
    layout['yaxis']['title'] = i.get('chart_percent', 'Percentá (%)')
    all_vals = [v for v in roa + roe + margin if v is not None]
    if all_vals:
        min_y = min(all_vals)
        max_y = max(all_vals)
        padding = max((max_y - min_y) * 0.1, 2)
        layout['yaxis']['range'] = [min_y - padding, max_y + padding]
    fig.update_layout(**layout)
    return _to_base64(fig, 600, 300)

def generate_radar_chart(pillars: list, lang="sk") -> str:
    # Filter out penalty pillars (max_score == 0) — they have negative scores
    # that don't make sense as percentages on a radar chart.
    radar_pillars = [p for p in pillars if p.get("max_score", 0) > 0]
    if not radar_pillars or len(radar_pillars) < 3: return ""
    i = get_i18n_strings(lang)
    _pillar_name_map = {
        "Platobná schopnosť & Exekúcie": "pillar_payment",
        "Finančné zdravie": "pillar_financial",
        "Ziskovosť, Stabilita a Cash Flow": "pillar_profitability",
        "Rast & Trendová sila": "pillar_growth",
        "Právna bezúhonnosť": "pillar_legal",
        "Forenzný indikátor: Biely Kôň": "pillar_forensic",
        "Data Quality Multiplier": "pillar_dq",
    }
    labels = []
    for p in radar_pillars:
        raw_name = p["name"].split("—")[0].strip()
        key = _pillar_name_map.get(p["name"])
        if key:
            raw_name = i.get(key, raw_name).split("—")[0].strip()
        
        # Break long labels into up to 3 lines at word boundaries
        # (single split at first space left 25+ char second lines that clipped at edges)
        if len(raw_name) > 16 and " " in raw_name:
            words = raw_name.split(" ")
            lines = []
            current = ""
            for w in words:
                if current and len(current) + len(w) + 1 > 14:
                    lines.append(current)
                    current = w
                else:
                    current = f"{current} {w}" if current else w
            if current:
                lines.append(current)
            raw_name = "<br>".join(lines)

        labels.append(raw_name)
    scores = [p["score"] for p in radar_pillars]
    max_scores = [p["max_score"] for p in radar_pillars]
    pcts = [s / m * 100 if m and m > 0 else 0 for s, m in zip(scores, max_scores)]

    fig = go.Figure(data=go.Scatterpolar(
        r=pcts + [pcts[0]],
        theta=labels + [labels[0]],
        fill='toself',
        fillcolor='rgba(16,185,129,0.2)',
        line=dict(color=COLORS['green'], width=2),
        marker=dict(size=8, color=COLORS['green'])
    ))

    annotations = []
    penalty_pillars = [p for p in pillars if p.get("max_score", 0) == 0 and p.get("score", 0) != 0]
    if penalty_pillars:
        penalty_texts = []
        for p in penalty_pillars:
            raw_name = p["name"].split("—")[0].strip()
            key = _pillar_name_map.get(p["name"])
            if key:
                raw_name = i.get(key, raw_name).split("—")[0].strip()
            penalty_texts.append(f"⚠ {raw_name}: {p['score']}")
        annotations.append(dict(
            text="<br>".join(penalty_texts),
            xref="paper", yref="paper", x=0.5, y=-0.08,
            xanchor="center", yanchor="top",
            font=dict(size=10, color=COLORS['red'], family=COLORS['font_family']),
            bgcolor="rgba(239,68,68,0.08)",
            bordercolor="rgba(239,68,68,0.2)",
            borderwidth=1, borderpad=4,
        ))

    fig.update_layout(
        polar=dict(
            radialaxis=dict(visible=True, range=[0, 100], tickvals=[20,40,60,80,100], gridcolor=COLORS['grid'], linecolor=COLORS['grid'], angle=45, tickangle=45),
            angularaxis=dict(gridcolor=COLORS['grid'], linecolor=COLORS['grid'], tickfont=dict(size=11, color=COLORS['text_light'], family=COLORS['font_family']))
        ),
        showlegend=False,
        plot_bgcolor='rgba(0,0,0,0)',
        paper_bgcolor='rgba(0,0,0,0)',
        margin=dict(l=100, r=100, t=60, b=90 if annotations else 60),
        annotations=annotations,
    )
    return _to_base64(fig, 700, 620)

def generate_debt_donut(stmt, lang="sk") -> str:
    if not stmt: return ""
    i = get_i18n_strings(lang)
    equity = _to_float(getattr(stmt, 'equity', None))
    short_liab = _to_float(getattr(stmt, 'shortTermLiabilities', None))
    long_liab = _to_float(getattr(stmt, 'longTermLiabilities', None))
    total_assets = _to_float(getattr(stmt, 'totalAssets', None))
    if equity == 0 and short_liab == 0 and long_liab == 0: return ""

    other_pasiva = max(0, total_assets - max(0, equity) - short_liab - long_liab)

    labels_all = [i.get('donut_equity', 'Vlastné imanie'), i.get('donut_short_liab', 'Krátkodobé záväzky'), i.get('donut_long_liab', 'Dlhodobé záväzky'), i.get('sankey_other_pasiva', 'Ostatné pasíva')]
    values_all = [equity, short_liab, long_liab, other_pasiva]
    colors_all = [COLORS['green'], COLORS['amber'], COLORS['red'], COLORS['slate_light']]
    
    filtered = [(l, v, c) for l, v, c in zip(labels_all, values_all, colors_all) if v > 0]
    if len(filtered) < 2: return ""
    labels, values, colors = zip(*filtered)

    fig = go.Figure(data=[go.Pie(
        labels=labels, values=values, hole=.5,
        marker=dict(colors=colors, line=dict(color='#ffffff', width=2)),
        textinfo='percent',
        texttemplate='%{percent:.1%}',
        textfont=dict(size=16, color='#ffffff', family=COLORS['font_family'], weight='bold'),
        insidetextorientation='horizontal'
    )])

    fig.update_layout(
        showlegend=True,
        legend=dict(orientation="v", yanchor="middle", y=0.5, xanchor="left", x=1.02, font=dict(size=12, color=COLORS['text_light'])),
        plot_bgcolor='rgba(0,0,0,0)',
        paper_bgcolor='rgba(0,0,0,0)',
        margin=dict(l=10, r=160, t=20, b=20)
    )
    return _to_base64(fig, 700, 420)


def generate_employee_chart(statements, lang="sk") -> str:
    """Vývoj počtu zamestnancov v čase."""
    statements = _prepare_statements(statements)
    valid = [s for s in statements if getattr(s, 'employeeCount', None)]
    if len(valid) < 2:
        return ""
    i = get_i18n_strings(lang)
    years = [str(s.year) for s in valid]
    counts = [s.employeeCount for s in valid]

    fig = go.Figure()
    fig.add_trace(go.Bar(
        x=years, y=counts,
        name=i.get('chart_employee_count', 'Počet zamestnancov'),
        marker_color=f'rgba(59,130,246,0.7)',
        marker_line_color=COLORS['blue'],
        marker_line_width=1,
        text=[f'{c:,}'.replace(',', ' ') for c in counts],
        textposition='outside',
        textfont=dict(size=10, color=COLORS['text_light']),
    ))

    layout = get_base_layout(i.get('chart_employee_count', 'Vývoj počtu zamestnancov'))
    max_count = max(counts) if counts else 100
    layout['yaxis'] = dict(showgrid=True, gridcolor='#e2e8f0', zeroline=False, tickfont=dict(color='#64748b'), title=dict(text=i.get('chart_employees', 'zamestnancov'), font=dict(size=10, color='#64748b')), range=[0, max_count * 1.18])
    layout['showlegend'] = False
    layout['margin'] = dict(l=40, r=40, t=50, b=45, pad=5)
    fig.update_layout(**layout)
    fig.update_xaxes(tickmode='array', tickvals=list(range(len(years))), ticktext=years, type='category')
    return _to_base64(fig, 600, 320)


def generate_rpe_chart(statements, lang="sk") -> str:
    """Vývoj tržieb na zamestnanca v čase."""
    statements = _prepare_statements(statements)
    valid = [s for s in statements if getattr(s, 'employeeCount', None) and getattr(s, 'mainActivityRevenue', None)]
    if len(valid) < 2:
        return ""
    i = get_i18n_strings(lang)
    years = [str(s.year) for s in valid]
    rpe = [_sanitize_value(s.mainActivityRevenue / s.employeeCount) for s in valid]

    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=years, y=rpe,
        name=i.get('chart_rpe', 'Tržby / zamestnanec'),
        mode='lines+markers+text',
        line=dict(color=COLORS['green'], width=2.5),
        marker=dict(size=8, color=COLORS['green'], line=dict(color='white', width=1.5)),
        text=[f'{int(v):,} €'.replace(',', ' ') for v in rpe],
        textposition='top center',
        textfont=dict(size=9, color='#059669'),
        fill='tozeroy',
        fillcolor='rgba(16,185,129,0.08)',
    ))

    avg = sum(rpe) / len(rpe)
    fig.add_hline(y=avg, line_dash="dash", line_color=f'rgba(148,163,184,0.6)',
                  annotation_text=f"{i.get('chart_average', 'Priemer')} {int(avg):,} €".replace(',', ' '),
                  annotation_position="top right",
                  annotation_font=dict(size=9, color=COLORS['slate_light']))

    layout = get_base_layout(i.get('chart_rpe', 'Tržby na zamestnanca'))
    layout['yaxis'] = dict(showgrid=True, gridcolor='#e2e8f0', zeroline=False, tickfont=dict(color='#64748b'),
                           tickformat=',.0f', tickprefix='', hoverformat=',.0f €')
    layout['showlegend'] = False
    fig.update_layout(**layout)
    fig.update_xaxes(tickmode='array', tickvals=list(range(len(years))), ticktext=years, type='category')
    return _to_base64(fig, 600, 280)


def generate_asset_composition_donut(stmt, lang="sk") -> str:
    """Donut chart: štruktúra aktív (neobežný vs obežný vs časové rozlíšenie).

    Rozklad celkových aktív na:
    - Dlhodobý nehmotný majetok
    - Dlhodobý hmotný majetok
    - Dlhodobý finančný majetok
    - Obežný majetok
    - Časové rozlíšenie
    """
    if not stmt:
        return ""
    i = get_i18n_strings(lang)
    intangible = _to_float(getattr(stmt, 'intangibleAssets', None))
    tangible = _to_float(getattr(stmt, 'tangibleAssets', None))
    lt_financial = _to_float(getattr(stmt, 'ltFinancialAssets', None))
    current = _to_float(getattr(stmt, 'currentAssets', None))
    deferred = _to_float(getattr(stmt, 'deferredAssets', None))

    labels_all = [
        i.get('asset_intangible', 'Nehmotný majetok'),
        i.get('asset_tangible', 'Hmotný majetok'),
        i.get('asset_lt_financial', 'Dlhodobý fin. majetok'),
        i.get('asset_current', 'Obežný majetok'),
        i.get('asset_deferred', 'Časové rozlíšenie'),
    ]
    values_all = [intangible, tangible, lt_financial, current, deferred]
    colors_all = [COLORS['blue_light'], COLORS['blue'], COLORS['blue_dark'], COLORS['green'], COLORS['slate_light']]

    filtered = [(l, v, c) for l, v, c in zip(labels_all, values_all, colors_all) if v > 0]
    if len(filtered) < 2:
        return ""
    labels, values, colors = zip(*filtered)

    fig = go.Figure(data=[go.Pie(
        labels=labels, values=values, hole=.5,
        marker=dict(colors=colors, line=dict(color='#ffffff', width=2)),
        textinfo='percent',
        texttemplate='%{percent:.1%}',
        textfont=dict(size=14, color='#ffffff', family=COLORS['font_family'], weight='bold'),
        insidetextorientation='horizontal'
    )])

    fig.update_layout(
        showlegend=True,
        legend=dict(orientation="v", yanchor="middle", y=0.5, xanchor="left", x=1.02,
                    font=dict(size=11, color=COLORS['text_light'])),
        plot_bgcolor='rgba(0,0,0,0)',
        paper_bgcolor='rgba(0,0,0,0)',
        margin=dict(l=10, r=140, t=10, b=10)
    )
    return _to_base64(fig, 600, 360)


def generate_equity_composition_donut(stmt, lang="sk") -> str:
    """Donut chart: štruktúra vlastného imania.

    Rozklad vlastného imania na:
    - Základné imanie
    - Kapitálové fondy + rezervné fondy
    - Nerozdelený zisk minulých rokov
    - Výsledok hospodárenia bežného roka
    """
    if not stmt:
        return ""
    i = get_i18n_strings(lang)
    share_capital = _to_float(getattr(stmt, 'shareCapital', None))
    other_funds = (
        _to_float(getattr(stmt, 'sharePremium', None)) +
        _to_float(getattr(stmt, 'otherCapitalFunds', None)) +
        _to_float(getattr(stmt, 'statutoryReserveFunds', None)) +
        _to_float(getattr(stmt, 'otherProfitFunds', None))
    )
    retained = _to_float(getattr(stmt, 'retainedProfit', None))
    # Ak je neuhradená strata, odčítame ju od nerozdeleného zisku
    accumulated_loss = _to_float(getattr(stmt, 'accumulatedLoss', None))
    if accumulated_loss > 0 and retained > 0:
        retained = max(0, retained - accumulated_loss)
    current_year = _to_float(getattr(stmt, 'currentYearProfit', None))

    labels_all = [
        i.get('equity_share_capital', 'Základné imanie'),
        i.get('equity_funds', 'Kapitálové a rezervné fondy'),
        i.get('equity_retained', 'Nerozdelený zisk'),
        i.get('equity_current_year', 'Výsledok bežného roka'),
    ]
    values_all = [share_capital, other_funds, retained, current_year]
    colors_all = [COLORS['blue'], COLORS['blue_light'], COLORS['green'], COLORS['green_light']]

    filtered = [(l, v, c) for l, v, c in zip(labels_all, values_all, colors_all) if v > 0]
    if len(filtered) < 2:
        return ""
    labels, values, colors = zip(*filtered)

    fig = go.Figure(data=[go.Pie(
        labels=labels, values=values, hole=.5,
        marker=dict(colors=colors, line=dict(color='#ffffff', width=2)),
        textinfo='percent',
        texttemplate='%{percent:.1%}',
        textfont=dict(size=14, color='#ffffff', family=COLORS['font_family'], weight='bold'),
        insidetextorientation='horizontal'
    )])

    fig.update_layout(
        showlegend=True,
        legend=dict(orientation="v", yanchor="middle", y=0.5, xanchor="left", x=1.02,
                    font=dict(size=11, color=COLORS['text_light'])),
        plot_bgcolor='rgba(0,0,0,0)',
        paper_bgcolor='rgba(0,0,0,0)',
        margin=dict(l=10, r=140, t=10, b=10)
    )
    return _to_base64(fig, 600, 360)
