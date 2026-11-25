from PIL import Image, ImageDraw, ImageFont
import cv2, numpy as np, math, os

W,H,FPS=1280,720,24
OUT='/home/user/public/videos'
os.makedirs(OUT,exist_ok=True)
BG='#F6F2E9'; PAPER='#FFFEFA'; INK='#27312C'; MUTED='#747A72'; TEAL='#287B68'; MINT='#DCECE4'; CORAL='#D97855'; GOLD='#D9AF63'; LINE='#E7E1D4'; NAVY='#36504A'; PALE='#EEF3EA'
FONT='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'; BOLD='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
def ft(sz,b=False): return ImageFont.truetype(BOLD if b else FONT,sz)
def rr(d,box,r,fill,outline=None,w=1): d.rounded_rectangle(box,radius=r,fill=fill,outline=outline,width=w)
def txt(d,xy,s,size=24,color=INK,b=False,anchor=None): d.text(xy,s,font=ft(size,b),fill=color,anchor=anchor)
def center(d,y,s,size=26,color=INK,b=False): txt(d,(W//2,y),s,size,color,b,'mm')
def wrap(d,s,font,maxw):
 out=[]; line=''
 for word in s.split():
  test=(line+' '+word).strip()
  if d.textbbox((0,0),test,font=font)[2]<=maxw: line=test
  else:
   if line: out.append(line)
   line=word
 if line: out.append(line)
 return out
def paragraph(d,x,y,s,size=18,color=MUTED,maxw=540,leading=1.45,b=False):
 f=ft(size,b)
 for line in wrap(d,s,f,maxw):
  d.text((x,y),line,font=f,fill=color); y+=int(size*leading)
 return y
def background():
 im=Image.new('RGB',(W,H),BG); d=ImageDraw.Draw(im)
 # soft warm light, faint grid, corner glows
 for i in range(8):
  a=12-i
  d.ellipse((930-i*35,-220-i*20,1430+i*40,300+i*25),fill=(245,236,219))
 d.rectangle((0,0,W,H),fill=BG)
 # faint matrix lines
 for x in range(0,W,48): d.line((x,0,x,H),fill='#F1EDE4',width=1)
 for y in range(0,H,48): d.line((0,y,W,y),fill='#F1EDE4',width=1)
 return im

def brand(d,x=64,y=48):
 rr(d,(x,y,x+36,y+36),11,TEAL)
 txt(d,(x+18,y+17),'✳',21,'#FFFFFF',True,'mm')
 txt(d,(x+49,y+5),'realitycheck',19,INK,True); txt(d,(x+185,y+5),'.ai',19,TEAL,True)
def pill(d,x,y,label,fill=MINT,color=TEAL):
 f=ft(13,True); w=d.textbbox((0,0),label,font=f)[2]+24
 rr(d,(x,y,x+w,y+30),15,fill); txt(d,(x+12,y+7),label,13,color,True)
def button(d,box,label,fill=TEAL,color='#FFFFFF'):
 rr(d,box,12,fill); txt(d,((box[0]+box[2])//2,(box[1]+box[3])//2),label,17,color,True,'mm')
def footer(d,progress,caption):
 rr(d,(64,664,1216,670),3,'#E6E0D4'); rr(d,(64,664,64+int(1152*progress),670),3,TEAL)
 txt(d,(64,685),caption.upper(),11,MUTED,True)
def panel_shell(d,title='Founder desk'):
 rr(d,(526,83,1185,630),21,PAPER,LINE,2)
 rr(d,(526,83,1185,132),21,'#FBF9F3'); d.rectangle((526,112,1185,132),fill='#FBF9F3')
 for i,c in enumerate([CORAL,GOLD,TEAL]): d.ellipse((548+i*19,102,557+i*19,111),fill=c)
 txt(d,(626,99),title,14,MUTED,True)

def intro_frame(t):
 im=background();d=ImageDraw.Draw(im); brand(d)
 pill(d,64,150,'THE HONEST STARTUP CHECK')
 progress=t/12
 if t<3:
  txt(d,(64,233),'Every startup',56,INK,True); txt(d,(64,300),'starts with a',56,INK,True); txt(d,(64,367),'hunch.',65,TEAL,True)
  paragraph(d,67,463,'Before you invest months of work, check whether the customer problem is real.',19,MUTED,420)
  rr(d,(716,179,1148,555),28,PAPER,LINE,2); pill(d,754,220,'THE IDEA',MINT)
  txt(d,(754,278),'What if a',24,INK,True); txt(d,(754,315),'better question',24,INK,True); txt(d,(754,352),'came first?',29,TEAL,True)
  # orbiting customer signal
  cx,cy=932,461; d.ellipse((cx-50,cy-50,cx+50,cy+50),fill='#F1E8D7'); d.ellipse((cx-26,cy-26,cx+26,cy+26),fill=CORAL)
  for i in range(6):
   a=t*1.2+i*math.tau/6; x=cx+130*math.cos(a); y=cy+58*math.sin(a)
   d.line((cx,cy,x,y),fill='#D9E8DE',width=2); d.ellipse((x-15,y-15,x+15,y+15),fill=TEAL if i%2 else GOLD)
  center(d,597,'A promising story is still only a hypothesis.',17,MUTED)
 elif t<6:
  txt(d,(64,230),'Enthusiasm',53,INK,True); txt(d,(64,296),'isn’t evidence.',53,CORAL,True)
  paragraph(d,67,390,'Separate founder assumptions from what customers actually do, buy, and repeat.',19,MUTED,420)
  panel_shell(d,'What would count as proof?')
  cards=[('01','CUSTOMER PAIN','Recent, costly problem'),('02','PAYMENT','A real paid pilot'),('03','RETENTION','They come back')]
  for i,(n,h,s) in enumerate(cards):
   y=170+i*112; rr(d,(562,y,1149,y+91),15,'#FBF9F3',LINE)
   rr(d,(580,y+19,624,y+63),12,MINT); txt(d,(602,y+41),n,13,TEAL,True,'mm')
   txt(d,(645,y+19),h,13,MUTED,True); txt(d,(645,y+43),s,19,INK,True)
   txt(d,(1104,y+36),'↗',20,TEAL,True)
  button(d,(562,523,1149,572),'Ask for behavior, not compliments',TEAL)
 else:
  txt(d,(64,226),'Six perspectives.',50,INK,True); txt(d,(64,291),'One honest read.',50,TEAL,True)
  paragraph(d,67,379,'RealityCheck AI finds the weak assumptions before they become expensive.',19,MUTED,420)
  panel_shell(d,'SAMPLE REPORT · STRICT SCREENING')
  rr(d,(558,157,1154,574),18,'#FBF9F3',LINE)
  txt(d,(592,184),'SAMPLE IDEA',11,MUTED,True); txt(d,(592,210),'Local repair marketplace',21,INK,True)
  rr(d,(592,265,708,381),58,MINT); txt(d,(650,316),'31',42,TEAL,True,'mm'); txt(d,(650,349),'/100',13,MUTED,True,'mm')
  txt(d,(742,272),'UNPROVEN',12,CORAL,True); txt(d,(742,302),'Evidence required',22,INK,True)
  paragraph(d,742,338,'No verified customer, payment, or retention evidence submitted.',15,MUTED,345)
  for i,(lab,w) in enumerate([('Customer pain',56),('Payment proof',29),('Repeat use',40)]):
   yy=430+i*34;txt(d,(592,yy),lab,13,MUTED);rr(d,(742,yy+1,1062,yy+13),6,'#EAE5DA');rr(d,(742,yy+1,742+w*3,yy+13),6,TEAL)
  pill(d,592,540,'TEST FIRST',MINT,TEAL)
  # closing signature
  rr(d,(64,534,449,604),16,TEAL); txt(d,(91,551),'realitycheck.ai',24,'#FFFFFF',True); txt(d,(91,581),'VALIDATE WITH EVIDENCE, NOT APPLAUSE',10,'#D6EAE2',True)
 footer(d,progress,'Idea  →  pressure test  →  evidence-led next move')
 return im

def ui_landing(d):
 brand(d,552,104); pill(d,565,163,'ANTI-HYPE VALIDATION')
 txt(d,(560,222),'Your big idea.',36,INK,True); txt(d,(560,269),'Check the receipts.',31,CORAL,True)
 paragraph(d,564,323,'Six sharp perspectives. Zero polite clapping.',16,MUTED,315)
 button(d,(564,401,818,449),'Pressure-test my idea  ↗')
 # right graphic
 cx,cy=1030,390
 for r in [72,107,145]: d.ellipse((cx-r,cy-r,cx+r,cy+r),outline='#DDE7DD',width=2)
 d.ellipse((cx-51,cy-51,cx+51,cy+51),fill=TEAL); txt(d,(cx,cy),'✳',36,'#FFFFFF',True,'mm')
 for i in range(6):
  a=math.tau*i/6; x=cx+127*math.cos(a);y=cy+127*math.sin(a)
  d.ellipse((x-17,y-17,x+17,y+17),fill=PALE,outline='#D4E0D6',width=2);txt(d,(x,y),'✳',13,TEAL,True,'mm')

def ui_brief(d, cursor):
 panel_shell(d,'PUT YOUR IDEA ON THE TABLE')
 txt(d,(560,160),'01 / START WITH THE REAL PROBLEM',11,TEAL,True)
 txt(d,(560,195),'Start a reality check',26,INK,True)
 txt(d,(560,244),'Idea name',13,MUTED,True);rr(d,(560,267,1147,308),9,'#FFFFFF',LINE)
 txt(d,(576,279),'Jaipur Appliance Repair',15,INK)
 txt(d,(560,328),'Who is it for?',13,MUTED,True);rr(d,(560,351,1147,392),9,'#FFFFFF',LINE)
 txt(d,(576,363),'Homeowners with a broken appliance',14,INK)
 txt(d,(560,412),'What problem are you solving?',13,MUTED,True);rr(d,(560,435,1147,494),9,'#FFFFFF',LINE)
 txt(d,(576,446),'Find a trusted local repair person, fast.',14,INK)
 button(d,(915,533,1147,579),'Launch strict review  ↗')
 d.ellipse((cursor-10,548,cursor+10,568),fill=CORAL,outline='#FFFFFF',width=3)

def ui_panel(d):
 panel_shell(d,'SIX SPECIALIST LENSES')
 txt(d,(560,160),'THE WAR ROOM',11,TEAL,True);txt(d,(560,188),'Checking assumptions, not praising them.',22,INK,True)
 agents=[('Customer','Last real problem & workaround',TEAL),('Market','Reachable demand signals',GOLD),('Competitor','Alternatives & switching costs',CORAL),('Finance','Price, cost & payback',TEAL),('Devil’s Advocate','Cheapest way this could fail',CORAL),('CEO Agent','Decision & next experiment',GOLD)]
 for i,(name,sub,c) in enumerate(agents):
  row=i//2;col=i%2;x=560+col*294;y=254+row*93
  rr(d,(x,y,x+276,y+76),13,'#FBF9F3',LINE);d.ellipse((x+17,y+19,x+49,y+51),fill=MINT if c==TEAL else '#F7EBDD');d.ellipse((x+27,y+29,x+39,y+41),fill=c)
  txt(d,(x+61,y+17),name,14,INK,True);txt(d,(x+61,y+42),sub,11,MUTED)
 rr(d,(560,548,1132,559),6,'#E8E2D7');rr(d,(560,548,934,559),6,TEAL)
 txt(d,(560,577),'Evidence first · assumptions labelled · no invented research',11,MUTED)

def ui_report(d):
 panel_shell(d,'STRICT VALIDATION REPORT')
 pill(d,560,154,'SAMPLE · IDEA-ONLY REVIEW', '#F7E9DE',CORAL)
 txt(d,(560,203),'Jaipur Appliance Repair',24,INK,True)
 rr(d,(560,248,1132,372),18,'#FBF9F3',LINE)
 rr(d,(582,269,668,355),44,MINT);txt(d,(625,305),'31',32,TEAL,True,'mm');txt(d,(625,332),'/100',11,MUTED,True,'mm')
 txt(d,(692,269),'UNPROVEN — EVIDENCE REQUIRED',12,CORAL,True)
 txt(d,(692,298),'Demand hasn’t been proven.',19,INK,True)
 paragraph(d,692,330,'No verified customer or payment evidence in the brief.',13,MUTED,410)
 # evidence cards
 for i,(title,body,c) in enumerate([('Key risk','Urgency may not justify switching.',CORAL),('Evidence gap','No paid commitment supplied.',GOLD),('Next test','Offer 3 paid concierge pilots.',TEAL)]):
  x=560+i*194;rr(d,(x,395,x+181,509),13,'#FBF9F3',LINE);d.ellipse((x+16,412,x+26,422),fill=c)
  txt(d,(x+16,434),title,13,INK,True);paragraph(d,x+16,459,body,11,MUTED,149,1.4)
 button(d,(560,539,843,583),'Interview 15 homeowners  ↗')

def walk_frame(t):
 im=background();d=ImageDraw.Draw(im);brand(d)
 progress=t/20
 if t<5:
  pill(d,70,175,'01 · THE REALITY CHECK');txt(d,(70,245),'Your big idea.',42,INK,True);txt(d,(70,297),'Receipts, please.',42,CORAL,True)
  paragraph(d,73,365,'Six sharp perspectives. Zero polite clapping.',18,MUTED,390)
  panel_shell(d,'REALITYCHECK AI · HOME');ui_landing(d)
  footer(d,progress,'The honest startup check · RealityCheck AI')
 elif t<10:
  pill(d,70,175,'02 · SHARE YOUR BRIEF');txt(d,(70,245),'Describe the customer,',30,INK,True);txt(d,(70,292),'problem and stage.',35,TEAL,True)
  paragraph(d,73,365,'The panel treats founder claims as hypotheses until verified.',17,MUTED,390)
  panel_shell(d,'REALITYCHECK AI · IDEA BRIEF');ui_brief(d,590+int(530*(t-5)/5))
  footer(d,progress,'One customer segment · one painful problem · no fluff')
 elif t<15:
  pill(d,70,175,'03 · PRESSURE TEST');txt(d,(70,245),'Six lenses.',40,INK,True);txt(d,(70,297),'Real blind spots.',40,CORAL,True)
  paragraph(d,73,365,'Customer pain, demand, alternatives, economics, risks and the next decision.',17,MUTED,390)
  panel_shell(d,'REALITYCHECK AI · PANEL');ui_panel(d)
  footer(d,progress,'Specialist perspectives challenge the same brief')
 else:
  pill(d,70,175,'04 · MAKE THE NEXT MOVE');txt(d,(70,245),'Leave with a test,',37,INK,True);txt(d,(70,293),'not just a score.',37,TEAL,True)
  paragraph(d,73,365,'An idea-only score stays conservative. Bring customer behavior to earn stronger confidence.',17,MUTED,390)
  panel_shell(d,'REALITYCHECK AI · REPORT');ui_report(d)
  footer(d,progress,'Strict report · explicit evidence gaps · practical experiments')
 return im

def encode(filename,duration,renderer,kind):
 path=os.path.join(OUT,filename)
 writer=cv2.VideoWriter(path,cv2.VideoWriter_fourcc(*'mp4v'),FPS,(W,H))
 if not writer.isOpened(): raise RuntimeError('OpenCV MP4 encoder did not open')
 total=int(duration*FPS)
 for idx in range(total):
  t=idx/FPS
  frame=renderer(t)
  arr=cv2.cvtColor(np.asarray(frame),cv2.COLOR_RGB2BGR)
  writer.write(arr)
 writer.release()
 cap=cv2.VideoCapture(path);count=int(cap.get(cv2.CAP_PROP_FRAME_COUNT)); fps=cap.get(cv2.CAP_PROP_FPS);cap.release()
 print(filename, 'frames=',count,'fps=',fps,'duration=',round(count/fps,2),'bytes=',os.path.getsize(path))

encode('realitycheck-brand-intro.mp4',12,intro_frame,'intro')
encode('realitycheck-product-walkthrough.mp4',20,walk_frame,'walk')
