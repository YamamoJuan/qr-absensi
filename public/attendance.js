const attendanceForm = document.getElementById("attendanceForm");
const nameInput = document.getElementById("name");
const message = document.getElementById("message");
const submitButton = attendanceForm.querySelector("button[type='submit']");

function getSessionIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("sid") || params.get("sessionId") || params.get("id");
  const parts = window.location.pathname.split("/").filter(Boolean);
  const fromPath = parts[parts.length - 1];

  return String(fromQuery || fromPath || "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .split("?")[0]
    .split("#")[0]
    .replace(/\/+$/, "")
    .toLowerCase();
}

const sessionId = getSessionIdFromUrl();

if (!sessionId) {
  attendanceForm.classList.add("hidden");
  showMessage("QR tidak valid. Session tidak ditemukan.", false);
}

attendanceForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = nameInput.value.trim();

  if (!name) {
    showMessage("Nama wajib diisi.", false);
    nameInput.focus();
    return;
  }

  try {
    submitButton.disabled = true;
    submitButton.textContent = "Menyimpan...";

    const response = await fetch(`/api/attendance/${encodeURIComponent(sessionId)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      cache: "no-store",
      body: JSON.stringify({ name })
    });

    const contentType = response.headers.get("content-type") || "";
    const result = contentType.includes("application/json")
      ? await response.json()
      : { success: false, message: "Absen belum berhasil" };

    showMessage(result.message || "Absen belum berhasil", Boolean(result.success));

    if (result.success) {
      window.location.replace("/thank-you");
    }
  } catch (error) {
    showMessage("Absen belum berhasil. Coba scan ulang QR terbaru.", false);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Absen";
  }
});

function showMessage(text, isSuccess) {
  message.textContent = text;
  message.className = isSuccess ? "message success" : "message failed";
}
