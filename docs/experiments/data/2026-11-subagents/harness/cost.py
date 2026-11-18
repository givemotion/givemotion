import json,sys
# opus 5.5 list prices per MTok (assumed same as opus 4.x: in 5, out 25, cache write 6.25, read 0.5)
P={'in':5,'out':25,'cw':6.25,'cr':0.5}
for f in sys.argv[1:]:
    seen=set(); agg={}
    for line in open(f):
        e=json.loads(line)
        if e.get('type')!='assistant': continue
        m=e['message']; mid=m.get('id')
        if mid in seen: continue
        seen.add(mid)
        who='sub' if e.get('parent_tool_use_id') else 'main'
        who+=':'+m.get('model','?')[-12:]
        u=m.get('usage',{}); a=agg.setdefault(who,{'in':0,'out':0,'cw':0,'cr':0,'n':0})
        a['in']+=u.get('input_tokens',0); a['out']+=u.get('output_tokens',0)
        a['cw']+=u.get('cache_creation_input_tokens',0); a['cr']+=u.get('cache_read_input_tokens',0); a['n']+=1
    print(f.split('/')[-1])
    for w,a in agg.items():
        c={k:a[k]*P[k]/1e6 for k in P}
        print(f"  {w}: calls={a['n']} out={a['out']} cr={a['cr']} cw={a['cw']}  $ out={c['out']:.2f} cr={c['cr']:.2f} cw={c['cw']:.2f} total={sum(c.values()):.2f}")
