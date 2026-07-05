import re

with open("src/templates/partials/_financials.html", "r") as f:
    content = f.read()

# Define the new ordered block
new_blocks = """            {# Základné hodnoty #}
            <div>
                <p class="subsection-title-sm mb-1 text-slate-500">Základné hodnoty</p>
                <div class="grid grid-cols-4 gap-2">
                    {% set base_cards = [
                        ('Tržby', latest_stmt.mainActivityRevenue, 'format_number_millions'),
                        ('EBITDA', latest_ratios.ebitda if latest_ratios else None, 'format_number_millions'),
                        ('Aktíva', latest_stmt.totalAssets, 'format_number_millions'),
                        ('Vlastné imanie', latest_stmt.equity, 'format_number_millions'),
                    ] %}
                    {% for label, value, suffix in base_cards %}
                    <div class="bg-white p-1.5 rounded-lg border-l-4 border-slate-300 shadow-sm">
                        <p class="report-label">{{ label }}</p>
                        {% if value is not none %}
                        <p class="text-base font-black {% if value < 0 %}text-rose-600{% else %}text-slate-800{% endif %}">{% if suffix == 'format_number_millions' %}{{ value | format_number_millions }}<span class="text-xs font-bold text-slate-500 ml-1">mil. &#8364;</span>{% else %}{{ value }}{% endif %}</p>
                        {% else %}
                        <p class="text-base font-black text-slate-400">—</p>
                        {% endif %}
                    </div>
                    {% endfor %}
                </div>
            </div>
            {# Rast & Kvalita #}
            {% if piotroski_score is not none or yoy_revenue_growth is not none or yoy_profit_growth is not none %}
            <div>
                <p class="subsection-title-sm mb-1 text-slate-500">Rast & Kvalita</p>
                <div class="grid grid-cols-3 gap-2">
                    {% if yoy_revenue_growth is not none %}
                    <div class="bg-white p-1.5 rounded-lg border-l-4 {% if yoy_revenue_growth >= 10 %}border-emerald-400{% elif yoy_revenue_growth >= 0 %}border-amber-400{% else %}border-rose-400{% endif %} shadow-sm">
                        <p class="report-label">YoY Tržby</p>
                        <p class="text-base font-black {% if yoy_revenue_growth >= 0 %}text-emerald-600{% else %}text-rose-600{% endif %}">{% if yoy_revenue_growth > 0 %}+{% endif %}{{ yoy_revenue_growth }}%</p>
                    </div>
                    {% endif %}
                    {% if yoy_profit_growth is not none %}
                    <div class="bg-white p-1.5 rounded-lg border-l-4 {% if yoy_profit_growth >= 10 %}border-emerald-400{% elif yoy_profit_growth >= 0 %}border-amber-400{% else %}border-rose-400{% endif %} shadow-sm">
                        <p class="report-label">YoY Zisk</p>
                        <p class="text-base font-black {% if yoy_profit_growth >= 0 %}text-emerald-600{% else %}text-rose-600{% endif %}">{% if yoy_profit_growth > 0 %}+{% endif %}{{ yoy_profit_growth }}%</p>
                    </div>
                    {% endif %}
                    {% if piotroski_score is not none %}
                    <div class="bg-white p-1.5 rounded-lg border-l-4 {% if piotroski_score >= 7 %}border-emerald-400{% elif piotroski_score >= 5 %}border-amber-400{% else %}border-rose-400{% endif %} shadow-sm">
                        <p class="report-label">Piotroski F</p>
                        <p class="text-base font-black {% if piotroski_score >= 6 %}text-emerald-600{% elif piotroski_score >= 4 %}text-amber-600{% else %}text-rose-600{% endif %}">{{ piotroski_score }}/8</p>
                        <div class="w-full bg-slate-100 rounded-full mt-1" style="height: 3px;">
                            <div class="rounded-full" style="height: 3px; width: {{ piotroski_score / 8 * 100 }}%; background: {% if piotroski_score >= 6 %}#10b981{% elif piotroski_score >= 4 %}#f59e0b{% else %}#ef4444{% endif %};"></div>
                        </div>
                    </div>
                    {% endif %}
                </div>
            </div>
            {% endif %}
            {# Rentabilita #}
            <div>
                <p class="subsection-title-sm mb-1 text-slate-500">Rentabilita</p>
                <div class="grid grid-cols-4 gap-2">
                    {% set gross_margin = ((latest_stmt.grossProfit or 0) / latest_stmt.mainActivityRevenue * 100) | round(1) if latest_stmt.mainActivityRevenue and latest_stmt.mainActivityRevenue > 0 else None %}
                    {% set rent_cards = [
                        ('Hrubá marža', gross_margin, '%', true, 20),
                        ('EBITDA marža', latest_ratios.ebitda_margin_pct if latest_ratios.ebitda_margin_pct is defined else None, '%', true, 15),
                        ('Čistá marža', latest_ratios.net_profit_margin_pct, '%', true, 5),
                        ('ROE', latest_ratios.roe_pct, '%', true, 10),
                    ] %}
                    {% for label, value, suffix, is_pct, benchmark in rent_cards %}
                    <div class="bg-white p-1.5 rounded-lg border-l-4 {% if value is not none and is_pct and value < 0 %}border-rose-400{% elif value is not none and is_pct and value >= benchmark %}border-emerald-400{% elif value is not none and is_pct %}border-amber-400{% else %}border-slate-200{% endif %} shadow-sm">
                        <p class="report-label">{{ label }}</p>
                        {% if value is not none %}
                        <p class="text-base font-black {% if is_pct and value < 0 %}text-rose-600{% elif is_pct %}text-emerald-600{% else %}text-slate-800{% endif %}">{% if suffix == 'format_number_millions' %}{{ value | format_number_millions }}<span class="text-xs font-bold text-slate-500 ml-1">mil. &#8364;</span>{% elif suffix %}{{ value }}{{ suffix }}{% else %}{{ value }}{% endif %}</p>
                        {% else %}
                        <p class="text-base font-black text-slate-400">—</p>
                        {% endif %}
                    </div>
                    {% endfor %}
                </div>
            </div>
            {# Likvidita #}
            <div>
                <p class="subsection-title-sm mb-1 text-slate-500">Likvidita</p>
                <div class="grid grid-cols-4 gap-2">
                    {% set liq_cards = [
                        ('Current Ratio', latest_ratios.current_ratio, '', false, 2.0),
                        ('Quick Ratio', latest_ratios.quick_ratio, '', false, 1.0),
                        ('Cash Ratio', latest_ratios.cash_ratio, '', false, 0.5),
                        ('Working Cap.', latest_ratios.working_capital, 'format_number_millions', false, 0),
                    ] %}
                    {% for label, value, suffix, is_pct, benchmark in liq_cards %}
                    <div class="bg-white p-1.5 rounded-lg border-l-4 {% if value is not none and value >= benchmark %}border-emerald-400{% elif value is not none and value >= benchmark * 0.5 %}border-amber-400{% elif value is not none %}border-rose-400{% else %}border-slate-200{% endif %} shadow-sm">
                        <p class="report-label">{{ label }}</p>
                        {% if value is not none %}
                        <p class="text-base font-black text-slate-800">{% if suffix == 'format_number_millions' %}{{ value | format_number_millions }}{% elif suffix %}{{ value }}{{ suffix }}{% else %}{{ value }}{% endif %}</p>
                        {% if not is_pct and benchmark > 0 and value is not none %}
                        <div class="w-full bg-slate-100 rounded-full mt-1" style="height: 3px;">
                            <div class="rounded-full" style="height: 3px; width: {{ [value / benchmark * 100, 100] | min }}%; background: {% if value >= benchmark %}#10b981{% elif value >= benchmark * 0.5 %}#f59e0b{% else %}#ef4444{% endif %};"></div>
                        </div>
                        {% endif %}
                        {% else %}
                        <p class="text-base font-black text-slate-400">—</p>
                        {% endif %}
                    </div>
                    {% endfor %}
                </div>
            </div>
            {# Efektivita & Zadlženosť #}
            <div>
                <p class="subsection-title-sm mb-1 text-slate-500">Efektivita & Zadlženosť</p>
                <div class="grid grid-cols-3 gap-2">
                    {% set eff_cards = [
                        ('DSO (dni)', latest_ratios.dso_days, '', false, 60),
                        ('DPO (dni)', latest_ratios.dpo_days, '', false, 60),
                        ('D/E Ratio', latest_ratios.debt_to_equity, '', false, 2.0),
                    ] %}
                    {% for label, value, suffix, is_pct, benchmark in eff_cards %}
                    <div class="bg-white p-1.5 rounded-lg border-l-4 {% if label == 'D/E Ratio' %}{% if value is not none and value <= 1 %}border-emerald-400{% elif value is not none and value <= 3 %}border-amber-400{% elif value is not none %}border-rose-400{% else %}border-slate-200{% endif %}{% else %}{% if value is not none and value <= benchmark %}border-emerald-400{% elif value is not none and value <= benchmark * 1.5 %}border-amber-400{% elif value is not none %}border-rose-400{% else %}border-slate-200{% endif %}{% endif %} shadow-sm">
                        <p class="report-label">{{ label }}</p>
                        {% if value is not none %}
                        <p class="text-base font-black text-slate-800">{% if suffix == 'format_number_millions' %}{{ value | format_number_millions }}{% elif suffix %}{{ value }}{{ suffix }}{% else %}{{ value }}{% endif %}</p>
                        {% else %}
                        <p class="text-base font-black text-slate-400">—</p>
                        {% endif %}
                    </div>
                    {% endfor %}
                </div>
            </div>
            {# Peňažné toky (Cash Flow) #}
            <div>
                <p class="subsection-title-sm mb-1 text-slate-500">Peňažné toky (Cash Flow)</p>
                <div class="grid grid-cols-4 gap-2">
                    {% set new_cf_cards = [
                        ('Prevádzkový CF', latest_stmt.operatingCashFlow, 'format_number_millions'),
                        ('Investičný CF', latest_stmt.investingCashFlow, 'format_number_millions'),
                        ('Finančný CF', latest_stmt.financingCashFlow, 'format_number_millions'),
                        ('CF/Zisk', latest_ratios.cashflow_to_profit if latest_ratios else None, '×'),
                    ] %}
                    {% for label, value, suffix in new_cf_cards %}
                    <div class="bg-white p-1.5 rounded-lg border-l-4 {% if label == 'CF/Zisk' %}{% if value is not none and value >= 1.0 %}border-emerald-400{% elif value is not none and value >= 0.5 %}border-amber-400{% elif value is not none %}border-rose-400{% else %}border-slate-200{% endif %}{% else %}{% if value is not none and value > 0 %}border-emerald-400{% elif value is not none and value < 0 %}border-rose-400{% else %}border-slate-200{% endif %}{% endif %} shadow-sm">
                        <p class="report-label">{{ label }}</p>
                        {% if value is not none %}
                        <p class="text-base font-black {% if value < 0 and label != 'CF/Zisk' %}text-rose-600{% elif value > 0 and label != 'CF/Zisk' %}text-emerald-600{% elif label == 'CF/Zisk' and value >= 1.0 %}text-emerald-600{% elif label == 'CF/Zisk' and value < 0.5 %}text-rose-600{% else %}text-slate-800{% endif %}">{% if suffix == 'format_number_millions' %}{{ value | format_number_millions }}{% elif suffix == '×' %}{{ "%.1f"|format(value) }}×{% else %}{{ value }}{% endif %}</p>
                        {% else %}
                        <p class="text-base font-black text-slate-400">—</p>
                        {% endif %}
                    </div>
                    {% endfor %}
                </div>
            </div>"""

start_marker = "{# Majetok a Výsledky #}"
end_marker = "{# Rast & Kvalita #}"

# We want to replace everything from start_marker up to the block before `{% if ratios_chart_base64 %}`.
# Wait, let's use a regex to capture the whole `space-y-3` content block.
# Actually, we can just find where `{# Majetok a Výsledky #}` starts and `{% if ratios_chart_base64 %}` starts.

idx_start = content.find(start_marker)
idx_end = content.find("{% if ratios_chart_base64 %}")

if idx_start != -1 and idx_end != -1:
    new_content = content[:idx_start] + new_blocks + "\n            " + content[idx_end:]
    with open("src/templates/partials/_financials.html", "w") as f:
        f.write(new_content)
    print("Successfully replaced blocks.")
else:
    print("Could not find markers!")

