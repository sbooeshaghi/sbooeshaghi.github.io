function copyOnClick() {
  var element = document.getElementById("creditName");
  var text = element.innerText;

  // Copy the text inside the text field
  navigator.clipboard.writeText(text);

  // Alert the copied text
  alert("Copied the text: " + text);
}
