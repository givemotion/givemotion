# The test animation shared by the benchmarks: one GSAP timeline, 10 s at 1920x1080.
# Three drifting gradient blobs (so every frame changes), a staggered title, a growing bar chart, sliding cards.
body = '''
<div class="bg"><i class="b1"></i><i class="b2"></i><i class="b3"></i></div>
<h1 id="title"><span>Same</span> <span>content,</span> <span>two</span> <span>renderers</span></h1>
<div id="bars">%s</div>
<div id="cards"><div class="card">Fast</div><div class="card">Exact</div><div class="card">Open</div></div>
''' % ''.join(f'<div class="bar" style="--h:{h}%"><b>{h}</b></div>' for h in [30, 55, 42, 78, 64, 92])
css = '''
html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#090b12;font-family:Inter,sans-serif;color:#fff}
.bg{position:absolute;inset:0;overflow:hidden}
.bg i{position:absolute;width:1300px;height:1300px;border-radius:50%;opacity:.8}
.b1{left:-300px;top:-500px;background:radial-gradient(closest-side,#4f46e5cc,#4f46e533 45%,transparent)}
.b2{right:-400px;top:0;background:radial-gradient(closest-side,#0ea5e9cc,#0ea5e933 45%,transparent)}
.b3{left:300px;bottom:-700px;background:radial-gradient(closest-side,#db2777cc,#db277733 45%,transparent)}
#title{position:absolute;left:140px;top:110px;margin:0;font-size:110px;letter-spacing:-.04em}
#title span{display:inline-block}
#bars{position:absolute;left:140px;bottom:120px;width:900px;height:520px;display:flex;align-items:flex-end;gap:28px}
.bar{flex:1;height:var(--h);border-radius:16px 16px 4px 4px;background:linear-gradient(#a5b4fc,#6366f1);transform-origin:bottom;position:relative}
.bar b{position:absolute;top:-56px;left:0;right:0;text-align:center;font-size:40px}
#cards{position:absolute;right:140px;bottom:140px;display:flex;flex-direction:column;gap:24px}
.card{width:520px;padding:36px 44px;border-radius:24px;background:#151a26;border:1px solid #ffffff1a;font-size:52px;font-weight:700;box-shadow:0 20px 60px #0008}
'''
tl = '''
const tl = gsap.timeline({ paused: true });
tl.to('.b1', { x: 420, y: 260, duration: 5, ease: 'sine.inOut', yoyo: true, repeat: 1 }, 0);
tl.to('.b2', { x: -460, y: 200, duration: 5, ease: 'sine.inOut', yoyo: true, repeat: 1 }, 0);
tl.to('.b3', { x: 260, y: -340, duration: 5, ease: 'sine.inOut', yoyo: true, repeat: 1 }, 0);
tl.from('#title span', { y: 80, opacity: 0, duration: 0.8, stagger: 0.12, ease: 'expo.out' }, 0.2);
tl.from('.bar', { scaleY: 0, duration: 1.1, stagger: 0.12, ease: 'expo.out' }, 1.0);
tl.from('.bar b', { opacity: 0, y: 20, duration: 0.5, stagger: 0.12 }, 1.4);
tl.from('.card', { x: 700, opacity: 0, duration: 0.9, stagger: 0.18, ease: 'back.out(1.4)' }, 4.5);
tl.to('#title', { y: -20, duration: 10, ease: 'none' }, 0);
tl.to('.bar', { scaleY: 0.85, duration: 1.2, stagger: 0.1, ease: 'sine.inOut', yoyo: true, repeat: 1 }, 6.5);
'''
