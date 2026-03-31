// Hover-to-play for template gallery video cards
document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('.tpl-card video').forEach(function (video) {
    video.parentElement.addEventListener('mouseenter', function () {
      video.play();
    });
    video.parentElement.addEventListener('mouseleave', function () {
      video.pause();
      video.currentTime = 2;
    });
  });
});

// Re-attach after client-side navigation (Mintlify uses SPA routing)
var observer = new MutationObserver(function () {
  document.querySelectorAll('.tpl-card video:not([data-hover-bound])').forEach(function (video) {
    video.setAttribute('data-hover-bound', 'true');
    video.parentElement.addEventListener('mouseenter', function () {
      video.play();
    });
    video.parentElement.addEventListener('mouseleave', function () {
      video.pause();
      video.currentTime = 2;
    });
  });
});
observer.observe(document.body, { childList: true, subtree: true });
