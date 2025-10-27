const { spawn } = require("child_process");
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

// ====== CẤU HÌNH ======
const srcL = path.join(__dirname, "Source", "srcVideoL");
const srcR = path.join(__dirname, "Source", "srcVideoR");
const bg = path.join(__dirname, "Source", "bg+logo", "bg.png");
//const bg = path.join(__dirname, "Source", "bg+logo", "chang.png");

const mask = path.join(__dirname, "Source", "bg+logo", "mask.png");
const logo = path.join(__dirname, "Source", "bg+logo", "logo.png");
const outputDir = path.join(__dirname, "output");
const filterPath = path.join(__dirname, "filter.txt").replace(/\\/g, "/");

// ====== FILTER (chung cho tất cả video) ======
let filterContent = `
[2:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setpts=PTS-STARTPTS[bg];
[0:v]scale=864:1536,setpts=PTS-STARTPTS[left];
[1:v]scale=864:1536,setpts=PTS-STARTPTS[right];
[3:v]format=gray,scale=864:1536,lut=a=val[mask];
[right][mask]alphamerge[rmask];
[bg][left]overlay=x=-100:y=(main_h-h)/2[tmp1];
[tmp1][rmask]overlay=x=(main_w-overlay_w)+100:y=(main_h-overlay_h)/2[blend];
[4:v]format=rgba,colorchannelmixer=aa=0.5[logo];
[blend][logo]overlay=x='(W/2 - w/2) + 200*sin(t*0.2)':y='(H/2 - h/2) + 500*cos(t*0.15)':enable='between(t,0,1000)'[out]
`.replace(/\n/g, " ");

fs.writeFileSync(filterPath, filterContent);

// Thêm hàm kiểm tra video stream (ffprobe phải có trong PATH)
function hasVideoStream(file) {
  try {
    const res = spawnSync("ffprobe", [
      "-v", "error",
      "-select_streams", "v",
      "-show_entries", "stream=index",
      "-of", "csv=p=0",
      file
    ], { encoding: "utf8" });
    return res.status === 0 && res.stdout && res.stdout.trim().length > 0;
  } catch (e) {
    return false;
  }
}

// ====== HÀM CHẠY FFmpeg CHO TỪNG CẶP ======
function runFFmpeg(videoL, videoR, outputPath) {  // ✅ thêm outputPath
  return new Promise((resolve, reject) => {
    const args = [
      "-i", videoL,
      "-i", videoR,
      "-i", bg,
      "-i", mask,
      "-i", logo,
      "-filter_complex_script", filterPath,
      "-map", "[out]",
      "-map", "1:a",               // ✅ âm thanh từ videoR
      "-c:a", "aac",
      "-b:a", "192k",
      "-pix_fmt", "yuv420p",
      "-c:v", "libx264",
      "-crf", "20",
      "-preset", "veryfast",
      "-shortest",
      "-y",
      outputPath                    // ✅ sử dụng outputPath (không dùng output)
    ];

    console.log(`▶️ Processing ${path.basename(videoL)} + ${path.basename(videoR)} → ${path.basename(outputPath)}`);
    const ff = spawn("ffmpeg", args, { stdio: "inherit" });

    ff.on("close", (code) => {
      if (code === 0) {
        console.log(`✅ Done: ${path.basename(outputPath)}`);
        resolve();
      } else {
        console.error(`❌ FFmpeg exited with code ${code} for ${outputPath}`);
        reject(new Error(`FFmpeg failed for ${outputPath}`));
      }
    });
  });
}


// ====== HÀM MAIN ======
(async () => {
  try {
    // Đảm bảo thư mục output tồn tại
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    // Lấy danh sách file trong 2 thư mục
    const listL = fs.readdirSync(srcL).filter(f => f.endsWith(".mp4")).sort();
    const listR = fs.readdirSync(srcR).filter(f => f.endsWith(".mp4")).sort();

    // Giới hạn số lượng theo cặp nhỏ nhất
    const total = Math.min(listL.length, listR.length);

    console.log(`🔄 Found ${total} video pairs to process.`);

    for (let i = 0; i < total; i++) {
      const videoL = path.join(srcL, listL[i]);
      const videoR = path.join(srcR, listR[i]);
      const outputPath = path.join(outputDir, `${i + 1}.mp4`); // ✅ dùng outputPath

      // validate inputs quickly
      if (!fs.existsSync(videoL)) { console.warn(`⚠️ Missing file: ${videoL} — skip`); continue; }
      if (!fs.existsSync(videoR)) { console.warn(`⚠️ Missing file: ${videoR} — skip`); continue; }
      if (!hasVideoStream(videoL)) { console.warn(`⚠️ No video stream in ${videoL} — skip`); continue; }
      if (!hasVideoStream(videoR)) { console.warn(`⚠️ No video stream in ${videoR} — skip`); continue; }

      // optional: check bg/mask/logo exist
      if (!fs.existsSync(bg) || !fs.existsSync(mask) || !fs.existsSync(logo)) {
        console.error("❌ Missing bg/mask/logo files."); break;
      }

      await runFFmpeg(videoL, videoR, outputPath); // ✅ truyền 3 tham số
    }

    console.log("🎉 All videos processed successfully!");
  } catch (err) {
    console.error("❌ Error:", err);
  }
})();
