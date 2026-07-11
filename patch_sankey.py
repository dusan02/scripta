import re

with open("worker/src/infographics.py", "r") as f:
    content = f.read()

# Update PL Sankey layout
content = content.replace("font_size=18,", "font=dict(size=14, family='Inter, sans-serif', color='#0f172a'),")
content = content.replace("thickness=20,", "thickness=30,")
content = content.replace("pad=15,", "pad=25,")
content = content.replace("line=dict(color=\"white\", width=0)", "line=dict(color=\"white\", width=1)")

# Update colors for PL Sankey
old_pl_colors = 'colors = [\n        "#10b981", "#ef4444", "#3b82f6",\n        "#ef4444", "#f59e0b", "#8b5cf6", "#64748b",\n        "#10b981",\n    ]'
new_pl_colors = 'colors = [\n        "#10b981", "#f43f5e", "#3b82f6",\n        "#f43f5e", "#f59e0b", "#8b5cf6", "#64748b",\n        "#10b981",\n    ]'
content = content.replace(old_pl_colors, new_pl_colors)

# Update BS Sankey colors
old_bs_colors = 'colors = [\n        "#22c55e", "#22c55e", "#22c55e", "#22c55e",\n        "#16a34a", "#16a34a",\n        "#3b82f6",\n        "#ef4444", "#10b981",\n        "#dc2626", "#dc2626", "#dc2626",\n    ]'
new_bs_colors = 'colors = [\n        "#34d399", "#34d399", "#34d399", "#34d399",\n        "#10b981", "#0ea5e9",\n        "#1e293b",\n        "#f43f5e", "#10b981",\n        "#e11d48", "#e11d48", "#e11d48",\n    ]'
content = content.replace(old_bs_colors, new_bs_colors)

# Update BS link colors
content = content.replace('link_color.append("#d1fae5")', 'link_color.append("rgba(16,185,129,0.25)")')
content = content.replace('link_color.append("#bbf7d0")', 'link_color.append("rgba(16,185,129,0.35)")')

# Fix layout params
content = content.replace("margin=dict(l=10, r=10, t=10, b=10)", "margin=dict(l=20, r=20, t=20, b=20)")

with open("worker/src/infographics.py", "w") as f:
    f.write(content)
print("Sankey styles patched")
