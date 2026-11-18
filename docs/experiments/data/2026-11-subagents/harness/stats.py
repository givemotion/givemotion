import json,sys,glob,os
for f in sorted(glob.glob(sys.argv[1]+'/*.jsonl')):
    name=os.path.basename(f)[:-6]
    if name.startswith('judge'): continue
    res=None; agents=[]; tools=0; imgs=0
    for line in open(f):
        try: e=json.loads(line)
        except: continue
        if e.get('type')=='result': res=e
        if e.get('type')=='assistant' and not e.get('parent_tool_use_id'):
            for c in e['message'].get('content',[]):
                if c.get('type')=='tool_use':
                    tools+=1
                    if c['name'] in ('Agent','Task'):
                        agents.append((c['input'].get('model','inherit'), c['input'].get('description','')[:40]))
    D=sys.argv[1]+'/'+name
    try: wall=int(open(D+'/meta.end').read())-int(open(D+'/meta.start').read())
    except: wall=None
    out=os.path.exists(D+'/out/video.mp4')
    if res:
        mu={k:round(v.get('costUSD',0),2) for k,v in res.get('modelUsage',{}).items()}
        print(f"{name}: ${res.get('total_cost_usd',0):.2f} wall={wall}s turns={res.get('num_turns')} tools={tools} video={out} models={mu} agents={agents}")
    else:
        print(f"{name}: running/failed wall={wall} tools={tools} agents={agents}")
