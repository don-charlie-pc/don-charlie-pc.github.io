(() => {
  "use strict";

  const config = window.siteConfig;
  const locales = window.siteLocales;
  const items = window.portfolioItems || [];
  const serviceItems = window.services || [];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const formatText = (template, values = {}) => template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");
  let currentLanguage = "en";
  try {
    const savedLanguage = window.localStorage.getItem("castellanos-language");
    if (savedLanguage && locales[savedLanguage]) currentLanguage = savedLanguage;
  } catch { /* Storage can be unavailable in private browsing. */ }
  let currentLocale = locales[currentLanguage];

  const populateContent = () => {
    document.querySelectorAll("[data-config]").forEach((element) => {
      const key = element.dataset.config;
      const value = key === "businessName" ? currentLocale.businessName : (currentLocale.settings[key] ?? config[key]);
      if (value) element.textContent = value;
    });
    document.querySelectorAll("[data-i18n-template]").forEach((element) => {
      const template = currentLocale.text[element.dataset.i18nTemplate];
      if (!template) return;
      const name = escapeHtml(config.photographerName);
      element.innerHTML = formatText(template, { name: `<span data-config="photographerName">${name}</span>` });
    });
    document.querySelectorAll('[data-link="instagram"]').forEach((link) => { link.href = config.instagramUrl; });
    document.querySelectorAll('[data-link="email"]').forEach((link) => {
      link.href = `mailto:${config.email}`;
      if (link.textContent.includes("@")) link.textContent = config.email;
    });
    document.title = currentLocale.pageTitle;
    document.getElementById("current-year").textContent = new Date().getFullYear();
  };

  const applyLocale = () => {
    currentLocale = locales[currentLanguage];
    document.documentElement.lang = currentLanguage === "es" ? "es-MX" : "en";
    document.querySelectorAll("[data-i18n]").forEach((element) => {
      const translation = currentLocale.text[element.dataset.i18n];
      if (translation !== undefined) element.textContent = translation;
    });
    document.querySelectorAll("[data-i18n-html]").forEach((element) => {
      const translation = currentLocale.text[element.dataset.i18nHtml];
      if (translation !== undefined) element.innerHTML = translation;
    });
    document.querySelectorAll("[data-i18n-attr]").forEach((element) => {
      element.dataset.i18nAttr.split(",").forEach((entry) => {
        const [attribute, key] = entry.split(":").map((part) => part.trim());
        if (attribute && key && currentLocale.text[key] !== undefined) element.setAttribute(attribute, currentLocale.text[key]);
      });
    });
    populateContent();
    const toggle = document.getElementById("language-toggle");
    toggle.textContent = currentLocale.text.switchLanguage;
    toggle.setAttribute("aria-label", currentLocale.text.switchLanguageAria);
    toggle.title = currentLocale.text.switchLanguageAria;
    toggle.lang = currentLanguage === "es" ? "en" : "es";
    const menuToggleLabel = document.querySelector(".menu-toggle .sr-only");
    menuToggleLabel.textContent = document.body.classList.contains("menu-open") ? currentLocale.text.closeNavigation : currentLocale.text.openNavigation;
    const description = document.querySelector('meta[name="description"]');
    const ogTitle = document.querySelector('meta[property="og:title"]');
    const ogDescription = document.querySelector('meta[property="og:description"]');
    const ogImageAlt = document.querySelector('meta[property="og:image:alt"]');
    const twitterTitle = document.querySelector('meta[name="twitter:title"]');
    const twitterDescription = document.querySelector('meta[name="twitter:description"]');
    if (description) description.content = currentLocale.metaDescription;
    if (ogTitle) ogTitle.content = currentLocale.pageTitle;
    if (ogDescription) ogDescription.content = currentLocale.metaDescription;
    if (ogImageAlt) ogImageAlt.content = currentLocale.socialImageAlt;
    if (twitterTitle) twitterTitle.content = currentLocale.pageTitle;
    if (twitterDescription) twitterDescription.content = currentLocale.metaDescription;
    document.querySelectorAll('.field [aria-invalid="true"]').forEach((field) => {
      const error = document.getElementById(`${field.id}-error`);
      if (error) error.textContent = field.validity.typeMismatch ? currentLocale.text.invalidEmail : currentLocale.text.requiredField;
    });
    const formStatus = document.getElementById("form-status");
    if (formStatus?.textContent) {
      const statusKey = Object.keys(locales).flatMap((language) => Object.keys(locales[language].text).filter((key) => ["checkFields", "openingEmail"].includes(key) && locales[language].text[key] === formStatus.textContent))[0];
      if (statusKey) formStatus.textContent = currentLocale.text[statusKey];
    }
    const schema = document.querySelector('script[type="application/ld+json"]');
    if (schema) {
      try {
        const structuredData = JSON.parse(schema.textContent);
        structuredData.name = currentLocale.businessName;
        structuredData.description = currentLocale.metaDescription;
        structuredData.email = `mailto:${config.email}`;
        structuredData.areaServed = currentLocale.areaServed;
        structuredData.sameAs = [config.instagramUrl];
        schema.textContent = JSON.stringify(structuredData);
      } catch { /* Keep the static structured data if it cannot be parsed. */ }
    }
  };

  const setupNavigation = () => {
    const header = document.getElementById("site-header");
    const button = document.querySelector(".menu-toggle");
    const nav = document.getElementById("site-nav");
    let framePending = false;
    const closeMenu = () => {
      button.setAttribute("aria-expanded", "false");
      button.querySelector(".sr-only").textContent = currentLocale.text.openNavigation;
      document.body.classList.remove("menu-open");
    };
    button.addEventListener("click", () => {
      const isOpen = button.getAttribute("aria-expanded") === "true";
      button.setAttribute("aria-expanded", String(!isOpen));
      button.querySelector(".sr-only").textContent = isOpen ? currentLocale.text.openNavigation : currentLocale.text.closeNavigation;
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
    document.getElementById("service-list").innerHTML = serviceItems.map((service) => {
      const content = service[currentLanguage];
      return `
      <article class="service reveal">
        <span class="service__number">${escapeHtml(service.number)}</span>
        <h3>${escapeHtml(content.name)}</h3>
        <p>${escapeHtml(content.description)}</p>
        <span class="service__price">${escapeHtml(content.price)}</span>
      </article>`;
    }).join("");
    setupRevealAnimations(document.getElementById("service-list"));
  };

  let visibleItems = [...items];
  let activeCategory = "all";
  let activeLightboxIndex = 0;
  let lastLightboxTrigger = null;
  const lightbox = document.getElementById("lightbox");
  const lightboxImage = document.getElementById("lightbox-image");

  const renderPortfolio = (category = activeCategory) => {
    const grid = document.getElementById("portfolio-grid");
    activeCategory = category;
    visibleItems = category === "all" ? [...items] : items.filter((item) => item.categoryKey === category);
    grid.innerHTML = visibleItems.map((item, index) => {
      const content = item[currentLanguage];
      return `
      <article class="portfolio-card portfolio-card--${escapeHtml(item.layout || "portrait")} reveal" data-category="${escapeHtml(content.category)}">
        <button type="button" data-gallery-index="${index}" aria-label="${escapeHtml(formatText(currentLocale.text.openImage, { title: content.title }))}">
          <span class="portfolio-card__image">
            <img src="${escapeHtml(item.image)}" alt="${escapeHtml(content.alt)}" loading="lazy" decoding="async">
            <span class="portfolio-card__view" aria-hidden="true">${escapeHtml(currentLocale.text.view)} <b>↗</b></span>
          </span>
          <span class="portfolio-card__caption"><span>${escapeHtml(content.title)}</span><span>${escapeHtml(content.category)}</span></span>
        </button>
      </article>`;
    }).join("");
    grid.querySelectorAll("[data-gallery-index]").forEach((button) => {
      button.addEventListener("click", () => openLightbox(Number(button.dataset.galleryIndex), button));
    });
    const categoryName = category === "all" ? "" : currentLocale.categories[category];
    const statusMessage = category === "all" ? currentLocale.text.showingAll : currentLocale.text.showingCategory;
    document.getElementById("portfolio-status").textContent = formatText(statusMessage, { count: visibleItems.length, category: categoryName });
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

  const setupLanguageToggle = () => {
    document.getElementById("language-toggle").addEventListener("click", () => {
      currentLanguage = currentLanguage === "en" ? "es" : "en";
      try { window.localStorage.setItem("castellanos-language", currentLanguage); } catch { /* The choice still applies for this visit. */ }
      applyLocale();
      renderPortfolio(activeCategory);
      renderServices();
      if (lightbox.open) {
        lastLightboxTrigger = document.querySelector(`[data-gallery-index="${activeLightboxIndex}"]`);
        updateLightbox();
      }
    });
  };

  const updateLightbox = () => {
    const item = visibleItems[activeLightboxIndex];
    if (!item) return;
    const content = item[currentLanguage];
    lightboxImage.classList.add("is-changing");
    window.setTimeout(() => {
      lightboxImage.src = item.image;
      lightboxImage.alt = content.alt;
      document.getElementById("lightbox-title").textContent = content.title;
      document.getElementById("lightbox-category").textContent = content.category;
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
      if (field.validity.valueMissing) message = currentLocale.text.requiredField;
      if (field.validity.typeMismatch) message = currentLocale.text.invalidEmail;
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
        status.textContent = currentLocale.text.checkFields;
        form.querySelector('[aria-invalid="true"]')?.focus();
        return;
      }
      const data = new FormData(form);
      const projectLabel = form.querySelector("#project option:checked")?.textContent || data.get("project");
      const subject = formatText(currentLocale.text.inquirySubject, { project: projectLabel });
      const body = [formatText(currentLocale.text.hello, { name: config.photographerName }), "", data.get("message"), "", `${currentLocale.text.from}: ${data.get("name")}`, `${currentLocale.text.email}: ${data.get("email")}`, `${currentLocale.text.project}: ${projectLabel}`].join("\n");
      status.textContent = currentLocale.text.openingEmail;
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

  applyLocale();
  setupNavigation();
  renderPortfolio();
  renderServices();
  setupFilters();
  setupLanguageToggle();
  setupLightbox();
  setupContactForm();
  setupPrivacy();
  setupRevealAnimations();
})();
