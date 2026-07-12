import re

# Update i18n.py
with open('src/i18n.py', 'r') as f:
    content = f.read()

# Add to SK
content = content.replace(
    '"scr_sp_not_found": "Žiadny záznam — subjekt nie je v zozname dlžníkov na sociálnom poistení.",',
    '"scr_sp_not_found": "Žiadny záznam — subjekt nie je v zozname dlžníkov na sociálnom poistení.",\n        "scr_sp_bot_block": "Sociálna poisťovňa zablokovala prístup (bot detekcia).",'
)

# Add to EN
content = content.replace(
    '"scr_sp_not_found": "No record — subject is not on the Social Insurance debtor list.",',
    '"scr_sp_not_found": "No record — subject is not on the Social Insurance debtor list.",\n        "scr_sp_bot_block": "Social Insurance blocked access (bot detection).",'
)

# Add to DE
content = content.replace(
    '"scr_sp_not_found": "Kein Eintrag — Subjekt ist nicht auf der SP-Schuldnerliste.",',
    '"scr_sp_not_found": "Kein Eintrag — Subjekt ist nicht auf der SP-Schuldnerliste.",\n        "scr_sp_bot_block": "Sociálna poisťovňa zablokovala prístup (bot detekcia).",\n        "scr_sp_bot_block": "Sozialversicherung hat den Zugriff blockiert (Bot-Erkennung).",'
)

with open('src/i18n.py', 'w') as f:
    f.write(content)

# Update report_generator.py
with open('src/report_generator.py', 'r') as f:
    rg_content = f.read()

rg_content = rg_content.replace(
    '(r"Žiadny záznam — subjekt nie je v zozname dlžníkov na sociálnom poistení\\.", "scr_sp_not_found", {}),',
    '(r"Žiadny záznam — subjekt nie je v zozname dlžníkov na sociálnom poistení\\.", "scr_sp_not_found", {}),\n    (r"Sociálna poisťovňa zablokovala prístup \\(bot detekcia\\)\\.", "scr_sp_bot_block", {}),'
)

with open('src/report_generator.py', 'w') as f:
    f.write(rg_content)
