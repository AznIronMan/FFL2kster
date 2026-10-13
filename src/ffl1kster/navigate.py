"""Field navigation for automation (tests, tools): breadth-first search over the map buffer
(D000, 64 wide) using the game's passability rule (00:13FA, probable from code, confirmed by every
route it plans being walkable): attribute pair (e, d) of the metatile from DF80 + 2*tile;
e bit 6 = blocked (event tile), e & 0xB0 = free, else blocked if d has the movement-mode bit
(mask table 00:1538; on foot = bit 0)."""
from collections import deque
DIRS={'up':(0,-1),'down':(0,1),'left':(-1,0),'right':(1,0)}
def passable(m,x,y,mode=0):
    if not(0<=x<64 and 0<=y<62): return False
    t=m[0xd000+(y<<6)+x]; e=m[0xdf80+2*(t&0x3f)]; d=m[0xdf81+2*(t&0x3f)]
    if e&0x40: return False          # 13FA nz: blocked
    if e&0xb0: return True           # z: free
    return not (d & (1<<mode))       # d low bits: blocked per movement mode (mask 00:1538)
def goto(e, target, max_steps=300, final_ok=False):
    m=e.pb.memory
    for _ in range(max_steps):
        p=e.position()
        if p==target: return True
        q=deque([p]); par={p:None}
        while q:
            c=q.popleft()
            if c==target: break
            for k,(dx,dy) in DIRS.items():
                n=(c[0]+dx,c[1]+dy)
                if n in par: continue
                if not passable(m,*n) and not (final_ok and n==target): continue
                par[n]=(c,k); q.append(n)
        if target not in par: return False
        c=target; path=[]
        while par[c]: c,k=par[c]; path.append(k)
        e.press(path[-1],wait=36)
        if e.position()==p: e.press(path[-1],wait=40)   # NPC in the way: wait and retry
    return e.position()==target
