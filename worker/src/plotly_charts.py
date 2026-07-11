import io
import base64
import plotly.graph_objects as go
import plotly.express as px
import numpy as np

def _fmt_currency(x):
    if abs(x) >= 1e6: return f'{x/1e6:.1f}M'
    if abs(x) >= 1e3: return f'{x/1e3:.0f}k'
    return f'{x:.0f}'

def get_base_layout(title):
    return dict(
        title=dict(text=title, font=dict(size=14, color='#0f172a', family='Inter, Arial, sans-serif')),
        plot_bgcolor='rgba(0,0,0,0)',
        paper_bgcolor='rgba(0,0,0,0)',
        margin=dict(l=40, r=40, t=50, b=45),
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1, font=dict(size=10, color='#475569')),
        xaxis=dict(showgrid=False, showline=True, linecolor='#e2e8f0', tickfont=dict(color='#64748b', size=11), tickangle=-30, automargin=True),
        yaxis=dict(showgrid=True, gridcolor='#e2e8f0', zeroline=True, zerolinecolor='#cbd5e1', tickfont=dict(color='#64748b'))
    )

def _to_base64(fig, width=1000, height=450):
    try:
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            img_bytes = fig.to_image(format="png", width=width, height=height, scale=2)
        return base64.b64encode(img_bytes).decode('utf-8')
    except Exception as e:
        print(f"Plotly render error: {e}")
        return ""

def generate_financial_chart(statements) -> str:
    if not statements or len(statements) < 2: return ""
    statements = sorted(statements, key=lambda x: x.year)
    years = [str(s.year) for s in statements]
    revenues = [s.mainActivityRevenue or 0 for s in statements]
    profits = [s.netProfitLoss or 0 for s in statements]

    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=years, y=revenues, name='Tržby', mode='lines+markers',
        line=dict(color='#1e293b', width=3, shape='spline'), marker=dict(size=8, color='#1e293b')
    ))
    color = '#10b981' if sum(profits) >= 0 else '#ef4444'
    fillcolor = 'rgba(16,185,129,0.1)' if sum(profits) >= 0 else 'rgba(239,68,68,0.1)'
    fig.add_trace(go.Scatter(
        x=years, y=profits, name='Čistý Zisk / Strata', mode='lines+markers',
        fill='tozeroy', fillcolor=fillcolor,
        line=dict(color=color, width=3, shape='spline'), marker=dict(size=8)
    ))

    layout = get_base_layout('Vývoj Tržieb a Zisku')
    fig.update_layout(**layout)
    return _to_base64(fig, 800, 400)

def generate_balance_sheet_chart(statements) -> str:
    if not statements or len(statements) < 2: return ""
    statements = sorted(statements, key=lambda x: x.year)
    years = [str(s.year) for s in statements]
    assets = [s.totalAssets or 0 for s in statements]
    equity = [s.equity or 0 for s in statements]
    debt = [((s.shortTermLiabilities or 0) + (s.longTermLiabilities or 0)) for s in statements]

    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=years, y=assets, name='Celkové Aktíva', mode='lines+markers',
        line=dict(color='#94a3b8', width=2, dash='dash'), marker=dict(size=7)
    ))
    fig.add_trace(go.Scatter(
        x=years, y=debt, name='Celkový Dlh', mode='lines+markers',
        fill='tozeroy', fillcolor='rgba(225,29,72,0.05)',
        line=dict(color='#e11d48', width=3, shape='spline'), marker=dict(size=8, symbol='triangle-up')
    ))
    fig.add_trace(go.Scatter(
        x=years, y=equity, name='Vlastné Imanie', mode='lines+markers',
        fill='tonexty', fillcolor='rgba(16,185,129,0.05)',
        line=dict(color='#10b981', width=3, shape='spline'), marker=dict(size=8, symbol='square')
    ))

    layout = get_base_layout('Štruktúra majetku a zdrojov')
    fig.update_layout(**layout)
    return _to_base64(fig, 800, 400)

def generate_pnl_chart(statements) -> str:
    if not statements or len(statements) < 2: return ""
    statements = sorted(statements, key=lambda x: x.year)
    years = [str(s.year) for s in statements]
    revenues = [s.mainActivityRevenue or 0 for s in statements]
    gross = [s.grossProfit or 0 for s in statements]
    ebitda = [(s.netProfitLoss or 0) + abs(s.interestExpense or 0) + (s.depreciation or 0) for s in statements]
    net = [s.netProfitLoss or 0 for s in statements]

    fig = go.Figure()
    fig.add_trace(go.Bar(x=years, y=revenues, name='Tržby', marker_color='#1e293b'))
    fig.add_trace(go.Bar(x=years, y=gross, name='Hrubá marža', marker_color='#3b82f6'))
    fig.add_trace(go.Bar(x=years, y=ebitda, name='EBITDA', marker_color='#f59e0b'))
    net_colors = ['#10b981' if v >= 0 else '#ef4444' for v in net]
    fig.add_trace(go.Bar(x=years, y=net, name='Čistý zisk', marker_color=net_colors))

    layout = get_base_layout('Výkaz ziskov a strát')
    layout['barmode'] = 'group'
    layout['bargap'] = 0.15
    layout['bargroupgap'] = 0.1
    fig.update_layout(**layout)
    return _to_base64(fig, 800, 350)

def generate_cashflow_chart(statements) -> str:
    if not statements or len(statements) < 2: return ""
    statements = sorted(statements, key=lambda x: x.year)
    years = [str(s.year) for s in statements]
    ocf_raw = [s.operatingCashFlow for s in statements]
    if all(v is None or v == 0 for v in ocf_raw): return ""
    ocf = [v or 0 for v in ocf_raw]
    icf = [s.investingCashFlow or 0 for s in statements]
    fcf = [s.financingCashFlow or 0 for s in statements]
    cash = [s.cashAndEquivalents or 0 for s in statements]

    fig = go.Figure()
    fig.add_trace(go.Bar(x=years, y=ocf, name='Prevádzkový CF', marker_color='#10b981'))
    fig.add_trace(go.Bar(x=years, y=icf, name='Investičný CF', marker_color='#ef4444'))
    fig.add_trace(go.Bar(x=years, y=fcf, name='Finančný CF', marker_color='#6366f1'))
    
    fig.add_trace(go.Scatter(
        x=years, y=cash, name='Cash & ekvivalenty', mode='lines+markers',
        line=dict(color='#1e293b', width=2, dash='dash'), marker=dict(size=8, symbol='diamond')
    ))

    layout = get_base_layout('Peňažné toky a likvidita')
    layout['barmode'] = 'relative'
    fig.update_layout(**layout)
    return _to_base64(fig, 800, 350)

def generate_liquidity_chart(statements) -> str:
    if not statements or len(statements) < 2: return ""
    statements = sorted(statements, key=lambda x: x.year)
    years = [str(s.year) for s in statements]
    wc = [(s.currentAssets or 0) - (s.shortTermLiabilities or 0) for s in statements]
    cr = [(s.currentAssets or 0) / (s.shortTermLiabilities or 1) for s in statements]
    qr = [((s.currentAssets or 0) - (s.inventory or 0)) / (s.shortTermLiabilities or 1) for s in statements]

    from plotly.subplots import make_subplots
    fig = make_subplots(specs=[[{"secondary_y": True}]])
    
    fig.add_trace(go.Bar(x=years, y=wc, name='Pracovný kapitál', marker_color='rgba(148,163,184,0.6)'), secondary_y=False)
    fig.add_trace(go.Scatter(x=years, y=cr, name='Current Ratio', mode='lines+markers', line=dict(color='#3b82f6', width=2), marker=dict(size=7)), secondary_y=True)
    fig.add_trace(go.Scatter(x=years, y=qr, name='Quick Ratio', mode='lines+markers', line=dict(color='#10b981', width=2), marker=dict(size=7, symbol='diamond')), secondary_y=True)
    
    # 1.0 threshold line
    fig.add_hline(y=1.0, line_dash="dash", line_color="rgba(239,68,68,0.5)", secondary_y=True)

    layout = get_base_layout('Likvidita a Pracovný kapitál')
    layout['yaxis'] = dict(showgrid=False, zeroline=True, zerolinecolor='#cbd5e1')
    layout['yaxis2'] = dict(showgrid=True, gridcolor='#e2e8f0', zeroline=False)
    fig.update_layout(**layout)
    return _to_base64(fig, 600, 300)

def generate_altman_chart(altman_scores) -> str:
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

    colors = ['#10b981' if s > 2.6 else '#f59e0b' if s >= 1.1 else '#ef4444' for s in scores]
    
    fig.add_trace(go.Scatter(
        x=years, y=scores, name='Z-Score', mode='lines+markers+text',
        text=[f"{s:.2f}" for s in scores],
        textposition="top center",
        textfont=dict(color=colors, size=14, family='Inter, sans-serif', weight='bold'),
        line=dict(color='#1e293b', width=2),
        marker=dict(size=12, color=colors, line=dict(color='#ffffff', width=2))
    ))

    layout = get_base_layout('Altman Z″-Score trend')
    layout['yaxis'].update(range=[min_y, max_y])
    layout['showlegend'] = False
    fig.update_layout(**layout)
    return _to_base64(fig, 600, 300)

def generate_ratios_trend_chart(trend_ratios: list) -> str:
    if not trend_ratios or len(trend_ratios) < 2: return ""
    years = [str(t["year"]) for t in trend_ratios]
    roa = [t.get("roa_pct") for t in trend_ratios]
    roe = [t.get("roe_pct") for t in trend_ratios]
    margin = [t.get("net_profit_margin_pct") for t in trend_ratios]

    fig = go.Figure()
    fig.add_trace(go.Scatter(x=years, y=roa, name='ROA', mode='lines+markers', line=dict(color='#10b981', width=3), marker=dict(size=8)))
    fig.add_trace(go.Scatter(x=years, y=roe, name='ROE', mode='lines+markers', line=dict(color='#3b82f6', width=3), marker=dict(size=8)))
    fig.add_trace(go.Scatter(x=years, y=margin, name='Čistá marža', mode='lines+markers', line=dict(color='#f59e0b', width=3), marker=dict(size=8)))

    fig.add_hline(y=0, line_dash="dash", line_color="#cbd5e1")
    layout = get_base_layout('Trend rentability')
    layout['yaxis']['title'] = 'Percentá (%)'
    fig.update_layout(**layout)
    return _to_base64(fig, 600, 300)

def generate_radar_chart(pillars: list) -> str:
    if not pillars or len(pillars) < 3: return ""
    labels = [p["name"].split("—")[0].strip()[:18] for p in pillars]
    scores = [p["score"] for p in pillars]
    max_scores = [p["max_score"] if p["max_score"] > 0 else 1 for p in pillars]
    pcts = [s / m * 100 for s, m in zip(scores, max_scores)]

    fig = go.Figure(data=go.Scatterpolar(
        r=pcts + [pcts[0]],
        theta=labels + [labels[0]],
        fill='toself',
        fillcolor='rgba(16,185,129,0.2)',
        line=dict(color='#10b981', width=2),
        marker=dict(size=8, color='#10b981')
    ))

    fig.update_layout(
        polar=dict(
            radialaxis=dict(visible=True, range=[0, 100], tickvals=[20,40,60,80,100], gridcolor='#e2e8f0', linecolor='#e2e8f0'),
            angularaxis=dict(gridcolor='#e2e8f0', linecolor='#e2e8f0', tickfont=dict(size=14, color='#475569', family='Inter, sans-serif', weight='bold'))
        ),
        showlegend=False,
        plot_bgcolor='rgba(0,0,0,0)',
        paper_bgcolor='rgba(0,0,0,0)',
        margin=dict(l=40, r=40, t=40, b=40)
    )
    return _to_base64(fig, 500, 500)

def generate_debt_donut(stmt) -> str:
    if not stmt: return ""
    equity = getattr(stmt, 'equity', None) or 0
    short_liab = getattr(stmt, 'shortTermLiabilities', None) or 0
    long_liab = getattr(stmt, 'longTermLiabilities', None) or 0
    if equity == 0 and short_liab == 0 and long_liab == 0: return ""

    labels_all = ['Vlastné imanie', 'Krátkodobé záväzky', 'Dlhodobé záväzky']
    values_all = [equity, short_liab, long_liab]
    colors_all = ['#10b981', '#f59e0b', '#ef4444']
    
    filtered = [(l, v, c) for l, v, c in zip(labels_all, values_all, colors_all) if v > 0]
    if len(filtered) < 2: return ""
    labels, values, colors = zip(*filtered)

    fig = go.Figure(data=[go.Pie(
        labels=labels, values=values, hole=.5,
        marker=dict(colors=colors, line=dict(color='#ffffff', width=2)),
        textinfo='percent', textfont=dict(size=24, color='#ffffff', family='Inter, sans-serif', weight='bold'),
        insidetextorientation='horizontal'
    )])

    fig.update_layout(
        showlegend=True,
        legend=dict(orientation="h", yanchor="top", y=-0.1, xanchor="center", x=0.5, font=dict(size=14, color='#475569')),
        plot_bgcolor='rgba(0,0,0,0)',
        paper_bgcolor='rgba(0,0,0,0)',
        margin=dict(l=20, r=20, t=20, b=20)
    )
    return _to_base64(fig, 600, 550)
