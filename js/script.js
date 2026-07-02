// Homepage hover Easter eggs: show a photo while hovering the linked word.
// Vanilla JS (no jQuery). Null-safe so it's a no-op when the bio block is
// commented out or the target images aren't present.
document.addEventListener('DOMContentLoaded', function () {
  [
    ['link_edwin', 'img_edwin'],
    ['link_blueno', 'img_blueno'],
    ['link_winter', 'img_winter'],
  ].forEach(function (pair) {
    var link = document.querySelector('.' + pair[0]);
    var img = document.querySelector('.' + pair[1]);
    if (!link || !img) return;
    link.addEventListener('mouseover', function () { img.style.display = 'block'; });
    link.addEventListener('mouseout', function () { img.style.display = 'none'; });
  });
});
