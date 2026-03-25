import os
import subprocess

def convert_to_hls_multi(input_path: str, output_dir: str):
    os.makedirs(output_dir, exist_ok=True)

    master_path = os.path.join(output_dir, "master.m3u8")

    # Skip if already processed
    if os.path.exists(master_path):
        return master_path

    renditions = [
        {"name": "144p", "scale": "256:144", "bitrate": "200k"},
        {"name": "240p", "scale": "426:240", "bitrate": "400k"},
        {"name": "360p", "scale": "640:360", "bitrate": "800k"},
        {"name": "480p", "scale": "854:480", "bitrate": "1400k"},
        {"name": "720p", "scale": "1280:720", "bitrate": "2800k"},
    ]

    playlist_entries = []

    for r in renditions:
        out_dir = os.path.join(output_dir, r["name"])
        os.makedirs(out_dir, exist_ok=True)

        output_path = os.path.join(out_dir, "index.m3u8")

        command = [
            "ffmpeg",
            "-i", input_path,
            "-vf", f"scale={r['scale']}",
            "-c:a", "aac",
            "-ar", "48000",
            "-c:v", "h264",
            "-profile:v", "main",
            "-crf", "20",
            "-sc_threshold", "0",
            "-g", "48",
            "-keyint_min", "48",
            "-b:v", r["bitrate"],
            "-maxrate", r["bitrate"],
            "-bufsize", "2M",
            "-hls_time", "4",
            "-hls_playlist_type", "vod",
            "-hls_segment_filename", os.path.join(out_dir, "seg_%03d.ts"),
            output_path
        ]

        subprocess.run(command, check=True)

        # Add to master playlist
        playlist_entries.append({
            "resolution": r["scale"].replace(":", "x"),
            "bandwidth": int(r["bitrate"].replace("k", "")) * 1000,
            "path": f"{r['name']}/index.m3u8"
        })

    # Create master playlist
    with open(master_path, "w") as f:
        f.write("#EXTM3U\n")
        for p in playlist_entries:
            f.write(
                f"#EXT-X-STREAM-INF:BANDWIDTH={p['bandwidth']},RESOLUTION={p['resolution']}\n"
            )
            f.write(f"{p['path']}\n")

    return master_path


def concat_segments_to_mp4(segment_paths: list, output_path: str) -> str:
    """
    Concatenate a list of .ts segment file paths into a single mp4.
    Used by the live analysis pipeline to assemble an analysis window.

    Args:
        segment_paths: ordered list of absolute paths to .ts files
        output_path:   destination .mp4 path

    Returns:
        output_path on success
    """
    import tempfile

    if not segment_paths:
        raise ValueError("segment_paths is empty – nothing to concatenate")

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    # Write a temporary ffmpeg concat list
    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
        concat_list = f.name
        for seg in segment_paths:
            abs_seg = os.path.abspath(seg).replace("\\", "/")
            f.write(f"file '{abs_seg}'\n")

    try:
        cmd = [
            "ffmpeg", "-y",
            "-f", "concat", "-safe", "0",
            "-i", concat_list,
            "-c:v", "libx264", "-c:a", "aac",
            "-preset", "fast", "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            "-loglevel", "error",
            output_path
        ]
        subprocess.run(cmd, check=True)
    finally:
        os.unlink(concat_list)

    return output_path


def cut_clip_from_mp4(source_path: str, start: float, end: float, output_path: str) -> str:
    """
    Cut a clip from an mp4 file between start and end seconds.
    Used by the live pipeline to extract highlight clips from analysis windows.
    """
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    cmd = [
        "ffmpeg", "-y",
        "-i", source_path,
        "-ss", str(start),
        "-to", str(end),
        "-c:v", "libx264", "-c:a", "aac",
        "-preset", "fast", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-loglevel", "error",
        output_path
    ]
    subprocess.run(cmd, check=True)
    return output_path