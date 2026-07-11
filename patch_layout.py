import re

with open("worker/src/plotly_charts.py", "r") as f:
    content = f.read()

# Make charts wider and slightly taller for a better aspect ratio in A4 landscape/portrait
content = content.replace("width=800, height=400", "width=1000, height=450")
content = content.replace("width=800, height=350", "width=1000, height=400")
content = content.replace("width=600, height=300", "width=800, height=350")
content = content.replace("width=500, height=500", "width=600, height=600")
content = content.replace("width=600, height=550", "width=800, height=600")

# Adjust get_base_layout margin to use more space
content = content.replace("margin=dict(l=40, r=20, t=50, b=30)", "margin=dict(l=40, r=40, t=50, b=30)")

with open("worker/src/plotly_charts.py", "w") as f:
    f.write(content)
print("Plotly layouts patched")
