const generateBtn = document.getElementById("generateBtn");
const qrSection = document.getElementById("qrSection");
const sessionIdText = document.getElementById("sessionIdText");
const qrImage = document.getElementById("qrImage");
const message = document.getElementById("message");

generateBtn.addEventListener("click", async () => {
  try {
    generateBtn.disabled = true;
    generateBtn.textContent = "Membuat QR...";

    const response = await fetch("/api/generate-session", {
      method: "POST"
    });

    const result = await response.json();

    if (!result.success) {
      showMessage("QR gagal dibuat", false);
      return;
    }

    sessionIdText.textContent = result.sessionId;
    qrImage.src = result.qrCodeDataUrl;

    qrSection.classList.remove("hidden");

    showMessage("QR berhasil dibuat. Silakan scan untuk absen.", true);
  } catch (error) {
    showMessage("QR gagal dibuat", false);
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = "Generate QR";
  }
});

function showMessage(text, isSuccess) {
  message.textContent = text;
  message.className = isSuccess ? "message success" : "message failed";
}
