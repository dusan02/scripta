import re

with open('src/i18n.py', 'r') as f:
    content = f.read()

crz_warn_en = '"scr_crz_contracts_found_warn": "WARNING: {count} contracts found in CRZ for IČO {ico} (shown on {pages} pages). We recommend reviewing the contracts in the generated PDF.",'
uvo_warn_en = '"scr_uvo_records_found_warn": "WARNING: {count} records found in UVO for IČO {ico} (shown on {pages} pages). We recommend reviewing the records in the generated PDF.",'

crz_warn_de = '"scr_crz_contracts_found_warn": "ACHTUNG: {count} Verträge im CRZ für IČO {ico} gefunden (angezeigt auf {pages} Seiten). Wir empfehlen, die Verträge im generierten PDF zu überprüfen.",'
uvo_warn_de = '"scr_uvo_records_found_warn": "ACHTUNG: {count} Einträge im UVO für IČO {ico} gefunden (angezeigt auf {pages} Seiten). Wir empfehlen, die Einträge im generierten PDF zu überprüfen.",'

crz_warn_sk = '"scr_crz_contracts_found_warn": "POZOR: Pre IČO {ico} sa našlo {count} zmlúv v CRZ (zobrazených na {pages} stranách). Odporúčame skontrolovať zmluvy vo vygenerovanom PDF.",'
uvo_warn_sk = '"scr_uvo_records_found_warn": "POZOR: Pre IČO {ico} sa našlo {count} záznamov v UVO (zobrazených na {pages} stranách). Odporúčame skontrolovať záznamy vo vygenerovanom PDF.",'

content = content.replace(
    '"scr_crz_contracts_found": "INFO: Pre IČO {ico} sa našlo {count} zmlúv v CRZ (zobrazených na {pages} stranách). Odporúčame skontrolovať zmluvy vo vygenerovanom PDF.",',
    f'"scr_crz_contracts_found": "INFO: Pre IČO {{ico}} sa našlo {{count}} zmlúv v CRZ (zobrazených na {{pages}} stranách). Odporúčame skontrolovať zmluvy vo vygenerovanom PDF.",\n        {crz_warn_sk}'
)

content = content.replace(
    '"scr_uvo_records_found": "INFO: Pre IČO {ico} sa našlo {count} záznamov v UVO (zobrazených na {pages} stranách). Odporúčame skontrolovať záznamy vo vygenerovanom PDF.",',
    f'"scr_uvo_records_found": "INFO: Pre IČO {{ico}} sa našlo {{count}} záznamov v UVO (zobrazených na {{pages}} stranách). Odporúčame skontrolovať záznamy vo vygenerovanom PDF.",\n        {uvo_warn_sk}'
)

content = content.replace(
    '"scr_crz_contracts_found": "INFO: {count} contracts found in CRZ for IČO {ico} (shown on {pages} pages). We recommend reviewing the contracts in the generated PDF.",',
    f'"scr_crz_contracts_found": "INFO: {{count}} contracts found in CRZ for IČO {{ico}} (shown on {{pages}} pages). We recommend reviewing the contracts in the generated PDF.",\n        {crz_warn_en}'
)

content = content.replace(
    '"scr_uvo_records_found": "INFO: {count} records found in UVO for IČO {ico} (shown on {pages} pages). We recommend reviewing the records in the generated PDF.",',
    f'"scr_uvo_records_found": "INFO: {{count}} records found in UVO for IČO {{ico}} (shown on {{pages}} pages). We recommend reviewing the records in the generated PDF.",\n        {uvo_warn_en}'
)

content = content.replace(
    '"scr_crz_contracts_found": "INFO: {count} Verträge im CRZ für IČO {ico} gefunden (angezeigt auf {pages} Seiten). Wir empfehlen, die Verträge im generierten PDF zu überprüfen.",',
    f'"scr_crz_contracts_found": "INFO: {{count}} Verträge im CRZ für IČO {{ico}} gefunden (angezeigt auf {{pages}} Seiten). Wir empfehlen, die Verträge im generierten PDF zu überprüfen.",\n        {crz_warn_de}'
)

content = content.replace(
    '"scr_uvo_records_found": "INFO: {count} Einträge im UVO für IČO {ico} gefunden (angezeigt auf {pages} Seiten). Wir empfehlen, die Einträge im generierten PDF zu überprüfen.",',
    f'"scr_uvo_records_found": "INFO: {{count}} Einträge im UVO für IČO {{ico}} gefunden (angezeigt auf {{pages}} Seiten). Wir empfehlen, die Einträge im generierten PDF zu überprüfen.",\n        {uvo_warn_de}'
)

with open('src/i18n.py', 'w') as f:
    f.write(content)
