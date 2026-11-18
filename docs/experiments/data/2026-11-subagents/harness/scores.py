import json,sys,re,glob
J=sys.argv[1]; key={}
for l in open(J+'/key.txt'):
    p=l.split(); key[p[0]]={'A':p[1][2:],'B':p[2][2:]}
tot={}; wins={}
for f in sorted(glob.glob(J+'/judge-*.jsonl')):
    j=f.split('/')[-1][:-6]; txt=None
    for line in open(f):
        e=json.loads(line)
        if e.get('type')=='result': txt=e.get('result','')
    m=re.search(r'\{.*\}\s*$',txt or '',re.S)
    if not m: print(j,'no json'); continue
    d=json.loads(m.group(0))
    for L in 'AB':
        v=key[j][L]; tot.setdefault(v,[]).append(d['scores'][L])
    w=key[j][d['ranking'][0]]; wins[w]=wins.get(w,0)+1
    print(j, {key[j][L]:d['scores'][L]['overall'] for L in 'AB'}, 'best:',w)
    for L in 'AB': print('   ',key[j][L],':',d['notes'][L])
for v,l in tot.items():
    avg={k:round(sum(x[k] for x in l)/len(l),2) for k in l[0]}
    print(v, avg, 'wins', wins.get(v,0))
