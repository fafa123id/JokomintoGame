function showMessage($message, $type = "error", $duration = 2000) { //message component
    if ($type === "success") {
      document.getElementById("message-container").style.backgroundColor =
        "#4BB543";
    } else {
      document.getElementById("message-container").style.backgroundColor =
        "#FF0000";
    }
    document.getElementById("message-container").style.display = "flex";
    document.getElementById("message").innerText = $message;
    setTimeout(() => {
      document.getElementById("message-container").style.display = "none";
    }, $duration);
  }
