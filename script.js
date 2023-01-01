// get the text from the DOM Element:
// when someone clicks on the <a class="copy-text"> element
// (which should be a <button>), execute the copy command:
document.addEventListener("DOMContentLoaded", function () {
  document.querySelector(".copy-text").addEventListener("click", () => {
    const textToCopy = document.getElementById("creditName").innerText;
    navigator.clipboard.writeText(textToCopy).then(
      function () {
        /* clipboard successfully set */
        window.alert("Success! The text was copied to your clipboard");
      },
      function () {
        /* clipboard write failed */
        window.alert("Opps! Your browser does not support the Clipboard API");
      }
    );
  });
});
