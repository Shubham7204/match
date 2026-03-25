import os
import shutil
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.staticfiles import StaticFiles

from utils.converter import convert_to_hls_multi

app = FastAPI()

UPLOAD_DIR = "uploads"
HLS_DIR = "hls"

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(HLS_DIR, exist_ok=True)

app.mount("/stream", StaticFiles(directory=HLS_DIR), name="stream")

@app.post("/upload/")
async def upload_video(file: UploadFile = File(...)):
    try:
        video_name = os.path.splitext(file.filename)[0]
        file_path = os.path.join(UPLOAD_DIR, file.filename)
        output_dir = os.path.join(HLS_DIR, video_name)

        master_playlist = os.path.join(output_dir, "master.m3u8")
        if os.path.exists(master_playlist):
            return {
                "message": "Already processed",
                "stream_url": f"/stream/{video_name}/master.m3u8"
            }

        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        convert_to_hls_multi(file_path, output_dir)

        return {
            "message": "Processed successfully",
            "stream_url": f"/stream/{video_name}/master.m3u8"
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/video/{video_name}")
def get_video(video_name: str):
    master_path = os.path.join(HLS_DIR, video_name, "master.m3u8")

    if not os.path.exists(master_path):
        raise HTTPException(status_code=404, detail="Video not found")

    return {
        "stream_url": f"/stream/{video_name}/master.m3u8"
    }

@app.get("/videos/")
def list_videos():
    videos = [
        v for v in os.listdir(HLS_DIR)
        if os.path.isdir(os.path.join(HLS_DIR, v))
    ]
    return {"videos": videos}

@app.delete("/video/{video_name}")
def delete_video(video_name: str):
    path = os.path.join(HLS_DIR, video_name)

    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Video not found")

    shutil.rmtree(path)

    return {"message": f"{video_name} deleted successfully"}