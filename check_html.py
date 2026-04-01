html = open('/Users/jtannenbaum/myy-music-player/index.html').read()
lines = html.split('\n')
start = None
for i, l in enumerate(lines):
    if 'id="left-sidebar"' in l:
        start = i
        break
print('Left sidebar opens at line', start+1)

depth = 1
for i in range(start+1, start+300):
    l = lines[i]
    opens = l.count('<div') + l.count('<aside') + l.count('<section') + l.count('<main')
    closes = l.count('</div>') + l.count('</aside>') + l.count('</section>') + l.count('</main>')
    depth += opens - closes
    if depth <= 0:
        print('LEFT SIDEBAR CLOSES at line', i+1, ':', l.strip()[:80])
        print('Lines after:')
        for j in range(i+1, i+10):
            print('  Line', j+1, ':', lines[j].strip()[:80])
        break
    if opens > 0 or closes > 0:
        print('  Line', i+1, '(depth='+str(depth)+')', l.strip()[:80])
