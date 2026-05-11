const attendanceForm = document.getElementById("attendanceForm");
const nameInput = document.getElementById("name");
const message = document.getElementById("message");

const pathParts = window.location.pathname.split("/");
const sessionId = pathParts[pathParts.length - 1];

attendanceForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = nameInput.value.trim();

  try {
    const response = await fetch(`/api/attendance/${sessionId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ name })
    });

    const result = await response.json();

    message.textContent = result.message;
    message.className = result.success ? "message success" : "message failed";

    if (result.success) {
      window.location.href = "/thank-you";
      return;
    }
  } catch (error) {
    message.textContent = "Absen belum berhasil";
    message.className = "message failed";
  }
});
