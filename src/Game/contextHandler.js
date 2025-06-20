//function untuk mengubah context coin
function changeCoin(value, operator) {
  let coin = parseInt(localStorage.getItem("coin")) || 0;

  let operation = operateContext(coin, value, operator);

  localStorage.setItem("coin", operation.toString());
}

//function untuk mengecheck nilai context, jika nilainya kurang dari 0 atau lebih dari 100, maka nilainya akan diubah menjadi 0 atau 100
function checkContext(param) {
  return Math.max(0, Math.min(100, param));
}

//function untuk mengubah context selain koin, misal hygiene, hunger, mood
function changeContext(context, value, operator) {
  let contexes = parseInt(localStorage.getItem(context)) || 0;

  let operation = checkContext(operateContext(contexes, value, operator));

  localStorage.setItem(context, operation.toString());
}

//function untuk mengoperasikan context, misal hygiene, hunger, mood, coin
function operateContext(context, value, operator) {
  if (operator === "+") {
    return context + value;
  } else if (operator === "-") {
    return context - value;
  } else {
    console.error("Invalid operator. Use '+' or '-'.");
    return;
  }
}

// Export functions
export { changeCoin, checkContext, changeContext, operateContext };

// Expose to window for global access
window.changeCoin = changeCoin;
window.checkContext = checkContext;
window.changeContext = changeContext;
window.operateContext = operateContext;