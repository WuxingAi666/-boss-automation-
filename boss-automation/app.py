"""BOSS助手后台 — pip install fastapi uvicorn sqlalchemy pypdfium2 pillow && python app.py"""
import json, asyncio, os, io
from datetime import datetime, date
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, StreamingResponse, FileResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime
from sqlalchemy.orm import declarative_base, sessionmaker

BASE = Path(__file__).parent
DB = BASE / "data" / "boss.db"
DB.parent.mkdir(exist_ok=True)
engine = create_engine(f"sqlite:///{DB}", echo=False)
Base = declarative_base()
Session = sessionmaker(bind=engine)

# ── 简历PNG（用户手动放项目文件夹里的图片） ──
RESUME_PNG = BASE / "仵星简历图片1.png"
if not RESUME_PNG.exists():
    # 兜底：尝试从PDF转换
    for pdf_path in [
        BASE.parent / "仵星的简历 .pdf",
        Path.home() / "Desktop" / "仵星的简历 .pdf",
        Path.home() / "Desktop" / "仵星简历1.pdf",
    ]:
        if pdf_path.exists():
            try:
                import pypdfium2 as pdfium
                pdf = pdfium.PdfDocument(str(pdf_path))
                bmp = pdf[0].render(scale=2.0)
                img = bmp.to_pil()
                img.save(str(RESUME_PNG), 'PNG')
                print(f'[简历] PNG已从PDF生成: {RESUME_PNG}')
            except Exception as e:
                print(f'[简历] 转换失败: {e}')
            break

if RESUME_PNG.exists():
    print(f'[简历] 已加载: {RESUME_PNG}')
else:
    print('[简历] ⚠️ 未找到简历图片，请将简历PNG放到项目文件夹')

class ApplyLog(Base):
    __tablename__ = "apply_logs"
    id = Column(Integer, primary_key=True)
    title = Column(String(256))
    company = Column(String(256))
    greeting = Column(Text)
    created_at = Column(DateTime, default=lambda: datetime.utcnow() + __import__('datetime').timedelta(hours=8))

class DailyStat(Base):
    __tablename__ = "daily_stats"
    id = Column(Integer, primary_key=True)
    date = Column(String(16), unique=True)
    count = Column(Integer, default=0)

Base.metadata.create_all(engine)

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
subscribers = []

def td(): return date.today().isoformat()

DASHBOARD = Path(__file__).parent / "dashboard.html"

@app.get("/")
async def home():
    if DASHBOARD.exists(): return HTMLResponse(DASHBOARD.read_text(encoding="utf-8"))
    return HTMLResponse("<h1>BOSS助手后台</h1>")

@app.get("/resume.png")
async def resume_png():
    """提供简历PNG图片给脚本调用"""
    if RESUME_PNG.exists():
        return FileResponse(str(RESUME_PNG), media_type="image/png")
    return Response("resume not found", status_code=404)

@app.get("/api/status")
async def status():
    s = Session()
    try:
        d = s.query(DailyStat).filter_by(date=td()).first()
        total = s.query(ApplyLog).count()
        return {"today_count": d.count if d else 0, "total_applied": total, "ok": True}
    finally: s.close()

@app.post("/api/report")
async def report(request: Request):
    data = await request.json()
    s = Session()
    try:
        if data.get("type") in ("apply", "apply_start"):
            ji = data.get("jobInfo", {})
            log = ApplyLog(title=ji.get("title",""), company=ji.get("company",""), greeting=data.get("greeting",""))
            s.add(log)
            d = s.query(DailyStat).filter_by(date=td()).first()
            if not d: d = DailyStat(date=td(), count=0); s.add(d); s.flush()
            d.count = (d.count or 0) + 1
            s.commit()
            msg = json.dumps({"type":"apply","title":log.title,"company":log.company,"count":d.count}, ensure_ascii=False)
            for q in subscribers:
                try: q.put_nowait(msg)
                except: pass
        return {"ok": True}
    finally: s.close()

@app.get("/api/history")
async def history(limit: int = 50):
    s = Session()
    try:
        logs = s.query(ApplyLog).order_by(ApplyLog.created_at.desc()).limit(limit).all()
        return {"data": [{"title":l.title,"company":l.company,"greeting":l.greeting,"applied_at":l.created_at.isoformat() if l.created_at else None} for l in logs]}
    finally: s.close()

@app.get("/api/sse")
async def sse(request: Request):
    q = asyncio.Queue(); subscribers.append(q)
    async def stream():
        try:
            while True:
                if await request.is_disconnected(): break
                try: data = await asyncio.wait_for(q.get(), timeout=30); yield f"data: {data}\n\n"
                except asyncio.TimeoutError: yield "data: {\"type\":\"ping\"}\n\n"
        finally: subscribers.remove(q)
    return StreamingResponse(stream(), media_type="text/event-stream")

if __name__ == "__main__":
    import uvicorn
    print(f"\n  BOSS助手后台: http://127.0.0.1:8899\n")
    uvicorn.run(app, host="127.0.0.1", port=8899)
