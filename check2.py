import re
html = open('/Users/jtannenbaum/myy-music-player/index.html').read()
lines = html.split('\n')

# Find all right-sidebar in HTML  
print("=== right-sidebar in HTML/CSS ===")
for i, l in enumerate(lines):
    if 'right-sidebar' in l:
        tag = l.strip()[:100]
        print(f"  Line {i+1}: {tag}")

# Check what's immediately before/after the right-sidebar aside tag
print("\n=== Context around <aside id=right-sidebar> ===")
for i, l in enumerate(lines):
    if '<aside id="right-sidebar"' in l:
        for j in range(i-3, i+3):
            print(f"  L{j+1}: {lines[j].strip()[:100]}")

# Find all places where flex row container starts/ends
print("\n=== flex flex-1 container ===")  
for i, l in enumerate(lines):
    if 'flex flex-1 overflow' in l or ('flex-1' in l and 'overflow' in l and 'flex' in l and '<div' in l):
        print(f"  L{i+1}: {l.strip()[:100]}")
