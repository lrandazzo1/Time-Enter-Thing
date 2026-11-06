# Synthetic (fictional) Projector Excel reports mirroring the real report's structure:
# sheet "Report" with Project | Role | Work Location | Task Name, plus an "Options" sheet.
# Run: python3 scripts/make-excel-fixtures.py   (requires openpyxl)
from openpyxl import Workbook
from openpyxl.styles import Font
OUT = "tests/fixtures/excel/"

ROWS = [
    ("Acme Components - Adaptive Planning - Implementation (P001234-001)", "Consultant", "Main Office", "Planning"),
    ("Acme Components - Adaptive Planning - Implementation (P001234-001)", "Consultant", "Main Office", "Gears"),
    ("Acme Components - Adaptive Planning - Implementation (P001234-001)", "Consultant", "Main Office", "Gears"),
    ("Acme Components - Adaptive Planning - Implementation (P001234-001)", "Senior Consultant", "Main Office", "Bearings"),
    ("Acme Components - Adaptive Planning - Implementation (P001234-001)", "Consultant", "Client Site", "Precision Parts"),
    ("Globex - Adaptive Planning - MSP (P005678-001)", "Consultant", "Main Office", "Planning Consultant"),
    ("Globex - Adaptive Planning - MSP (P005678-001)", "Consultant", "Main Office", "Planning Consultant"),
    ("The Metro Public Library (MPL) - Adaptive Planning - Implementation (P007979-001)", "Consultant", "Main Office", "Planning"),
    ("Smith-Jones Holdings - Adaptive Planning - Implementation (P002468-002)", "Consultant", "Remote", "Consultant"),
    ("Our Firm - Internal (P000999-001)", "Staff", "Main Office", "Internal - Meeting"),
    ("Our Firm - Internal (P000999-001)", "Staff", "Main Office", "Internal - Training"),
    ("Initech Annual Budget (P003141-001)", "Consultant", "Main Office", "Support"),
]

def options(ws, rng="01-Oct-2026 through 31-Oct-2026"):
    # Same style as Projector's Options sheet: one statement per row in column A.
    ws.append(["Time Card Report created 06-Nov-2026 1:36 PM (UTC-06:00) Central Time (US & Canada). All report times are in this time zone."])
    ws.append(["Report name: Example"])
    ws.append([f"Report includes data from {rng}."])
    ws.append(["Include billable engagements only: No"])
    ws.append(["Include approved time cards: Yes"])
    ws.append(["Include unapproved time cards: No"])
    ws.append(["Resource Search String: me"])

def options_kv(ws):
    ws.append(["Date Range", "11/01/2026 - 11/30/2026"])
    ws.append(["Staff", "Me"])

# 1. Same shape as the real report: header in row 1.
wb = Workbook()
ws = wb.active
ws.title = "Report"
ws.append(["Project", "Role", "Work Location", "Task Name"])
for c in ws[1]:
    c.font = Font(bold=True)
for r in ROWS:
    ws.append(list(r))
options(wb.create_sheet("Options"))
wb.save(OUT + "projector-report.xlsx")

# 2. Grouped layout: title rows above the header, project shown once per group, total rows,
#    reordered columns, an extra column and an Options sheet placed first.
wb = Workbook()
wo = wb.active
wo.title = "Options"
options_kv(wo)
ws = wb.create_sheet("Report")
ws.append(["Timecard Detail"])
ws.append(["Generated 11/06/2026"])
ws.append([])
ws.append(["Task Name", "Hours", "Project", "Work Location", "Role"])
ws.append(["Planning", 2.5, "Stark Logistics - Workday Adaptive Planning - Implementation (P004242-001)", "Main Office", "Consultant"])
ws.append(["Integration", 1.0, None, "Main Office", "Consultant"])
ws.append(["Total", 3.5, None, None, None])
ws.append(["Planning", 4.0, "Acme Components - Adaptive Planning - Implementation (P001234-001)", "Main Office", "Consultant"])
ws.append(["Training", 1.0, None, "Main Office", "Consultant"])
ws.append(["Grand Total", 8.5, None, None, None])
wb.save(OUT + "projector-report-grouped.xlsx")

# 3. Macro-enabled extension (data only).
wb = Workbook()
ws = wb.active
ws.title = "Report"
ws.append(["Project", "Role", "Work Location", "Task Name"])
ws.append(["Globex - Adaptive Planning - MSP (P005678-001)", "Consultant", "Main Office", "Planning Consultant"])
wb.save(OUT + "projector-report.xlsm")

# 4. Not a Projector report.
wb = Workbook()
wb.active.title = "Budget"
wb.active.append(["Account", "Jan", "Feb"])
wb.save(OUT + "not-a-report.xlsx")
print("written")
