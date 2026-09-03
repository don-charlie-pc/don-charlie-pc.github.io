(() => {
  "use strict";

  const config = window.siteConfig;
  const items = window.portfolioItems || [];
  const serviceItems = window.services || [];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

  const populateContent = () => {
    document.querySelectorAll("[data-config]").forEach((element) => {
      const key = element.dataset.config;
      if (config[key]) element.textContent = config[key];
    });
    document.querySelectorAll('[data-link="instagram"]').forEach((link) => { link.href = config.instagramUrl; });
    document.querySelectorAll('[data-link="email"]').forEach((link) => {
      link.href = `mailto:${config.email}`;
      if (link.textContent.includes("@")) link.textContent = config.email;
    });
    document.title = `${config.businessName} — Portrait & Editorial Photographer`;
    document.getElementById("current-year").textContent = new Date().getFullYear();
  };

  const setupNavigation = () => {
    const header = document.getElementById("site-header");
    const button = document.querySelector(".menu-toggle");
    const nav = document.getElementById("site-nav");
    let framePending = false;
    const closeMenu = () => {
      button.setAttribute("aria-expanded", "false");
      button.querySelector(".sr-only").textContent = "Open navigation";
      document.body.classList.remove("menu-open");
    };
    button.addEventListener("click", () => {
      const isOpen = button.getAttribute("aria-expanded") === "true";
      button.setAttribute("aria-expanded", String(!isOpen));
      button.querySelector(".sr-only").textContent = isOpen ? "Open navigation" : "Close navigation";
      document.body.classList.toggle("menu-open", !isOpen);
      if (!isOpen) nav.querySelector("a").focus();
    });
    nav.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && document.body.classList.contains("menu-open")) { closeMenu(); button.focus(); }
    });
    window.addEventListener("scroll", () => {
      if (framePending) return;
      framePending = true;
      window.requestAnimationFrame(() => {
        header.classList.toggle("is-compact", window.scrollY > 56);
        framePending = false;
      });
    }, { passive: true });
  };

  const renderServices = () => {
    document.getElementById("service-list").innerHTML = serviceItems.map((service) => `
      <article class="service reveal">
        <span class="service__number">${escapeHtml(service.number)}</span>
        <h3>${escapeHtml(service.name)}</h3>
        <p>${escapeHtml(service.description)}</p>
        <span class="service__price">${escapeHtml(service.price)}</span>
      </article>`).join("");
  };

  let visibleItems = [...items];
  let activeLightboxIndex = 0;
  let lastLightboxTrigger = null;
  const lightbox = document.getElementById("lightbox");
  const lightboxImage = document.getElementById("lightbox-image");

  const renderPortfolio = (category = "All") => {
    const grid = document.getElementById("portfolio-grid");
    visibleItems = category === "All" ? [...items] : items.filter((item) => item.category === category);
    grid.innerHTML = visibleItems.map((item, index) => `
      <article class="portfolio-card portfolio-card--${escapeHtml(item.layout || "portrait")} reveal" data-category="${escapeHtml(item.category)}">
        <button type="button" data-gallery-index="${index}" aria-label="Open ${escapeHtml(item.title)} in image viewer">
          <span class="portfolio-card__image">
            <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.alt)}" loading="lazy" decoding="async">
            <span class="portfolio-card__view" aria-hidden="true">View <b>↗</b></span>
          </span>
          <span class="portfolio-card__caption"><span>${escapeHtml(item.title)}</span><span>${escapeHtml(item.category)}</span></span>
        </button>
      </article>`).join("");
    grid.querySelectorAll("[data-gallery-index]").forEach((button) => {
      button.addEventListener("click", () => openLightbox(Number(button.dataset.galleryIndex), button));
    });
    document.getElementById("portfolio-status").textContent = `Showing ${visibleItems.length} ${category === "All" ? "portfolio images" : `${category} images`}.`;
    setupRevealAnimations(grid);
  };

  const setupFilters = () => {
    const buttons = [...document.querySelectorAll(".filter-button")];
    buttons.forEach((button) => button.addEventListener("click", () => {
      buttons.forEach((candidate) => {
        const isActive = candidate === button;
        candidate.classList.toggle("is-active", isActive);
        candidate.setAttribute("aria-pressed", String(isActive));
      });
      renderPortfolio(button.dataset.filter);
    }));
  };

  const updateLightbox = () => {
    const item = visibleItems[activeLightboxIndex];
    if (!item) return;
    lightboxImage.classList.add("is-changing");
    window.setTimeout(() => {
      lightboxImage.src = item.image;
      lightboxImage.alt = item.alt;
      document.getElementById("lightbox-title").textContent = item.title;
      document.getElementById("lightbox-category").textContent = item.category;
      document.getElementById("lightbox-count").textContent = `${String(activeLightboxIndex + 1).padStart(2, "0")} / ${String(visibleItems.length).padStart(2, "0")}`;
      lightboxImage.classList.remove("is-changing");
    }, reducedMotion ? 0 : 100);
    const nextItem = visibleItems[(activeLightboxIndex + 1) % visibleItems.length];
    if (nextItem) new Image().src = nextItem.image;
  };

  function openLightbox(index, trigger) {
    activeLightboxIndex = index;
    lastLightboxTrigger = trigger;
    updateLightbox();
    lightbox.showModal();
    document.body.classList.add("dialog-open");
    lightbox.querySelector(".lightbox__close").focus();
  }
  const closeLightbox = () => {
    if (!lightbox.open) return;
    lightbox.close();
    document.body.classList.remove("dialog-open");
    lastLightboxTrigger?.focus();
  };
  const moveLightbox = (direction) => {
    activeLightboxIndex = (activeLightboxIndex + direction + visibleItems.length) % visibleItems.length;
    updateLightbox();
  };
  const setupLightbox = () => {
    lightbox.querySelector(".lightbox__close").addEventListener("click", closeLightbox);
    lightbox.querySelector(".lightbox__prev").addEventListener("click", () => moveLightbox(-1));
    lightbox.querySelector(".lightbox__next").addEventListener("click", () => moveLightbox(1));
    lightbox.addEventListener("click", (event) => { if (event.target === lightbox) closeLightbox(); });
    lightbox.addEventListener("cancel", (event) => { event.preventDefault(); closeLightbox(); });
    lightbox.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft") moveLightbox(-1);
      if (event.key === "ArrowRight") moveLightbox(1);
    });
    let touchStart = 0;
    lightbox.addEventListener("touchstart", (event) => { touchStart = event.changedTouches[0].clientX; }, { passive: true });
    lightbox.addEventListener("touchend", (event) => {
      const distance = event.changedTouches[0].clientX - touchStart;
      if (Math.abs(distance) > 55) moveLightbox(distance > 0 ? -1 : 1);
    }, { passive: true });
  };

  const setupContactForm = () => {
    const form = document.getElementById("contact-form");
    const status = document.getElementById("form-status");
    const fields = [...form.querySelectorAll("input, select, textarea")];
    const validate = (field) => {
      const error = document.getElementById(`${field.id}-error`);
      let message = "";
      if (field.validity.valueMissing) message = "Please complete this field.";
      if (field.validity.typeMismatch) message = "Please enter a valid email address.";
      error.textContent = message;
      field.setAttribute("aria-invalid", String(Boolean(message)));
      return !message;
    };
    fields.forEach((field) => {
      field.addEventListener("blur", () => validate(field));
      field.addEventListener("input", () => { if (field.getAttribute("aria-invalid") === "true") validate(field); });
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const valid = fields.map(validate).every(Boolean);
      if (!valid) {
        status.textContent = "Please check the highlighted fields.";
        form.querySelector('[aria-invalid="true"]')?.focus();
        return;
      }
      const data = new FormData(form);
      const subject = `Photography inquiry — ${data.get("project")}`;
      const body = [`Hello ${config.photographerName},`, "", data.get("message"), "", `From: ${data.get("name")}`, `Email: ${data.get("email")}`, `Project: ${data.get("project")}`].join("\n");
      status.textContent = "Opening your email app…";
      window.location.href = `mailto:${config.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    });
  };

  const setupPrivacy = () => {
    const dialog = document.getElementById("privacy-dialog");
    document.querySelector("[data-open-privacy]").addEventListener("click", () => dialog.showModal());
    dialog.querySelector(".privacy-dialog__close").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  };

  function setupRevealAnimations(scope = document) {
    const elements = scope.querySelectorAll(".reveal:not([data-reveal-ready])");
    elements.forEach((element) => { element.dataset.revealReady = "true"; });
    if (reducedMotion || !("IntersectionObserver" in window)) {
      elements.forEach((element) => element.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver((entries, instance) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) { entry.target.classList.add("is-visible"); instance.unobserve(entry.target); }
      });
    }, { rootMargin: "0px 0px -8%", threshold: 0.08 });
    elements.forEach((element) => observer.observe(element));
  }

  populateContent();
  setupNavigation();
  renderPortfolio();
  renderServices();
  setupFilters();
  setupLightbox();
  setupContactForm();
  setupPrivacy();
  setupRevealAnimations();
})();
