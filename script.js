// get the text from the DOM Element:
// when someone clicks on the <a class="copy-text"> element
// (which should be a <button>), execute the copy command:
document.addEventListener("DOMContentLoaded", function () {
  document.querySelector(".copy-text").addEventListener("click", () => {
    // four things
    // department
    // institute
    // address
    const creditName = document.getElementById("creditName").innerText;
    const department = document.getElementById("department_0").innerText;
    const institute = document.getElementById("institute_0").innerText;
    const address = document.getElementById("address_0").innerText;
    const affil = `${department}, ${institute}, ${address}`;
    navigator.clipboard.writeText(affil).then(
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
