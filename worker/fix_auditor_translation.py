import re

with open('src/report_generator.py', 'r') as f:
    content = f.read()

helper = """
    def _translate_op(o_raw):
        if not o_raw: return ""
        lo = o_raw.lower()
        if 'bez výhrad' in lo or 'unqualified' in lo or 'ohne vorbehalt' in lo:
            return i18n_strings.get("auditor_unqualified", o_raw)
        if 'výhrad' in lo or 'qualified' in lo or 'vorbehalt' in lo:
            return i18n_strings.get("auditor_qualified", o_raw)
        if 'záporn' in lo or 'adverse' in lo:
            return i18n_strings.get("auditor_adverse", o_raw)
        if 'odmietnut' in lo or 'disclaimer' in lo or 'versagte' in lo:
            return i18n_strings.get("auditor_disclaimer", o_raw)
        return o_raw

    for stmt in (stmts or []):"""

content = content.replace("    for stmt in (stmts or []):", helper)

content = content.replace(
    "auditor_details.append(f\"{stmt.year}: {getattr(ao, 'opinionType', '')}\")",
    "auditor_details.append(f\"{stmt.year}: {_translate_op(getattr(ao, 'opinionType', ''))}\")"
)

with open('src/report_generator.py', 'w') as f:
    f.write(content)
