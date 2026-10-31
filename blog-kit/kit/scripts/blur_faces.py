# /// script
# requires-python = ">=3.9"
# dependencies = ["opencv-python-headless>=4.8,<5"]
# ///
"""사진 속 얼굴을 찾아 모자이크해요.  사용법: uv run scripts/blur_faces.py 원본.jpg 결과.jpg
찾은 얼굴 수를 마지막 줄에 숫자로 출력해요. 얼굴을 놓칠 수 있으니 결과는 꼭 눈으로 확인하세요."""
import sys
import cv2
import numpy as np


def detect(gray):
    found = []
    base = cv2.data.haarcascades
    for name in ("haarcascade_frontalface_default.xml", "haarcascade_frontalface_alt2.xml", "haarcascade_profileface.xml"):
        cascade = cv2.CascadeClassifier(base + name)
        for flipped in (False, True) if "profile" in name else (False,):
            img = cv2.flip(gray, 1) if flipped else gray
            min_side = max(24, min(gray.shape[:2]) // 40)
            for (x, y, w, h) in cascade.detectMultiScale(img, scaleFactor=1.08, minNeighbors=5, minSize=(min_side, min_side)):
                if flipped:
                    x = gray.shape[1] - x - w
                found.append((int(x), int(y), int(w), int(h)))
    return found


def pixelate(img, x, y, w, h):
    pad = int(max(w, h) * 0.25)
    x0, y0 = max(0, x - pad), max(0, y - pad)
    x1, y1 = min(img.shape[1], x + w + pad), min(img.shape[0], y + h + pad)
    roi = img[y0:y1, x0:x1]
    block = max(6, (x1 - x0) // 10)
    small = cv2.resize(roi, (max(1, (x1 - x0) // block), max(1, (y1 - y0) // block)), interpolation=cv2.INTER_LINEAR)
    img[y0:y1, x0:x1] = cv2.resize(small, (x1 - x0, y1 - y0), interpolation=cv2.INTER_NEAREST)


def main(src, dst):
    data = np.fromfile(src, dtype=np.uint8)  # 한글 경로도 읽히도록
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if img is None:
        sys.exit(f"사진을 열 수 없어요: {src}")
    gray = cv2.equalizeHist(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
    faces = detect(gray)
    for f in faces:
        pixelate(img, *f)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    if not ok:
        sys.exit("사진을 저장하지 못했어요")
    buf.tofile(dst)
    print(len(faces))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("사용법: uv run scripts/blur_faces.py 원본.jpg 결과.jpg")
    main(sys.argv[1], sys.argv[2])
