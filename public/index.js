const generateBtn = document.getElementById("generateBtn");
const qrSection = document.getElementById("qrSection");
const sessionIdText = document.getElementById("sessionIdText");
const qrImage = document.getElementById("qrImage");
const message = document.getElementById("message");

let attendanceLink = document.getElementById("attendanceLink");

if (!attendanceLink && qrSection) {
  attendanceLink = document.createElement("a");
  attendanceLink.id = "attendanceLink";
  attendanceLink.target = "_blank";
  attendanceLink.rel = "noopener noreferrer";
  attendanceLink.style.display = "block";
  attendanceLink.style.marginTop = "12px";
  attendanceLink.style.wordBreak = "break-all";
  attendanceLink.textContent = "Buka link absensi";
  qrSection.appendChild(attendanceLink);
}

generateBtn.addEventListener("click", async () => {
  try {
    generateBtn.disabled = true;
    generateBtn.textContent = "Membuat QR...";

    const response = await fetch("/api/generate-session", {
      method: "POST"
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      const backendError = result.error?.message ? ` Detail: ${result.error.message}` : "";
      showMessage(`${result.message || "QR gagal dibuat"}.${backendError}`, false);
      return;
    }

    sessionIdText.textContent = result.sessionId;
    qrImage.src = result.qrCodeDataUrl;

    if (attendanceLink) {
      attendanceLink.href = result.attendanceUrl;
      attendanceLink.textContent = result.attendanceUrl;
    }

    qrSection.classList.remove("hidden");

    showMessage("QR berhasil dibuat. Silakan scan untuk absen.", true);
  } catch (error) {
    showMessage(`QR gagal dibuat. Detail: ${error.message}`, false);
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = "Generate QR";
  }
});

function showMessage(text, isSuccess) {
  message.textContent = text;
  message.className = isSuccess ? "message success" : "message failed";
}
