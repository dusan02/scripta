import os
from google import genai
from dotenv import load_dotenv

load_dotenv()
client = genai.Client()
for m in client.models.list():
    if "generateContent" in getattr(m, "supported_generation_methods", getattr(m, "supported_actions", [])):
        print(m.name)
    else:
        # Just print the model names if we can't filter
        print(m.name)
