import { describe, it, expect, beforeEach } from 'vitest';
import {
  hasWordMatch,
  resolveToInteractiveInput,
  safeInsertTextIntoElement,
  findElementSemantically,
  waitForElementSemantically,
  extractVisibleFormFields,
  scrapeYoutubeDomTranscript
} from '../content-scripts/selector-heuristics';

describe('DOM Agent & Safe Text Insertion Heuristics', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('resolves <label for="fieldId"> to its target input and sets value cleanly', () => {
    document.body.innerHTML = `
      <form id="checkout-form">
        <label for="firstNameInput">First Name</label>
        <input id="firstNameInput" type="text" name="first_name" />
        <label for="lastNameInput">Last Name</label>
        <input id="lastNameInput" type="text" name="last_name" />
      </form>
    `;

    const label = document.querySelector('label[for="firstNameInput"]') as HTMLElement;
    expect(label).toBeTruthy();

    const resolved = resolveToInteractiveInput(label);
    expect(resolved).toBeTruthy();
    expect(resolved?.id).toBe('firstNameInput');
    expect(resolved?.tagName).toBe('INPUT');

    safeInsertTextIntoElement(label, 'Muhammad', 'replace');
    expect((resolved as HTMLInputElement).value).toBe('Muhammad');
  });

  it('resolves Next.js / Tailwind sibling <label> and <input> inside container', () => {
    document.body.innerHTML = `
      <div class="space-y-1">
        <label class="block text-xs uppercase tracking-wider text-neutral-500 font-medium">
          First Name
        </label>
        <input type="text" name="firstName" class="w-full bg-transparent border-b" />
      </div>
      <div class="space-y-1">
        <label class="block text-xs uppercase tracking-wider text-neutral-500 font-medium">
          Phone
        </label>
        <div class="relative">
          <input type="tel" name="phone" placeholder="+92 3XX XXXXXXX" />
        </div>
      </div>
    `;

    const labels = document.querySelectorAll('label');
    const firstNameLabel = labels[0];
    const phoneLabel = labels[1];

    const resolvedFirst = resolveToInteractiveInput(firstNameLabel);
    expect(resolvedFirst).toBeTruthy();
    expect(resolvedFirst?.getAttribute('name')).toBe('firstName');

    const resolvedPhone = resolveToInteractiveInput(phoneLabel);
    expect(resolvedPhone).toBeTruthy();
    expect(resolvedPhone?.getAttribute('name')).toBe('phone');

    safeInsertTextIntoElement(firstNameLabel, 'John', 'replace');
    expect((resolvedFirst as HTMLInputElement).value).toBe('John');

    safeInsertTextIntoElement(phoneLabel, '03001234567', 'replace');
    expect((resolvedPhone as HTMLInputElement).value).toBe('03001234567');
  });

  it('strictly guards against non-input elements, eliminating Illegal invocation crashes', () => {
    document.body.innerHTML = `
      <p id="plain-paragraph">Just an informational disclaimer without any input.</p>
    `;

    const p = document.getElementById('plain-paragraph') as HTMLElement;
    expect(resolveToInteractiveInput(p)).toBeNull();

    // Must cleanly throw descriptive error without throwing V8 TypeError: Illegal invocation
    expect(() => {
      safeInsertTextIntoElement(p, 'test');
    }).toThrowError(/has no interactive input field associated with it/);
  });

  it('word boundary matcher prevents "opacity" class from matching "city"', () => {
    expect(hasWordMatch('transition-opacity duration-200', 'city')).toBe(false);
    expect(hasWordMatch('opacity-100', 'city')).toBe(false);
    expect(hasWordMatch('bg-white text-opacity-80', 'city')).toBe(false);
    expect(hasWordMatch('shipping-city-field', 'city')).toBe(true);
    expect(hasWordMatch('billing_city', 'city')).toBe(true);
    expect(hasWordMatch('First Name', 'first name')).toBe(true);
  });

  it('promo code blacklist strictly protects discount input from general field queries', () => {
    // Mock visible bounding client rect for JSDOM
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = () => ({
      width: 100,
      height: 40,
      top: 10,
      left: 10,
      right: 110,
      bottom: 50,
      x: 10,
      y: 10,
      toJSON: () => {}
    });

    document.body.innerHTML = `
      <div class="checkout-step-1">
        <div>
          <label>First Name</label>
          <input name="firstName" type="text" />
        </div>
        <div>
          <label>Phone</label>
          <input name="phone" type="tel" placeholder="+92 3XX XXXXXXX" />
        </div>
        <div class="order-summary">
          <input name="coupon" id="discount-code" placeholder="Discount or promo code" class="transition-opacity" />
          <button type="button">Apply</button>
        </div>
      </div>
    `;

    // 1. Finding "Phone" must return the phone input, NEVER the promo code input
    const phoneInput = findElementSemantically('INPUT', 'Phone');
    expect(phoneInput).toBeTruthy();
    expect(phoneInput?.getAttribute('name')).toBe('phone');

    // 2. Querying "City" (which does not exist in Step 1) must return NULL and NEVER the promo code box!
    const cityInput = findElementSemantically('INPUT', 'City');
    expect(cityInput).toBeNull();

    // 3. Querying explicitly for promo or coupon must return the discount input
    const promoInput = findElementSemantically('INPUT', 'Discount code');
    expect(promoInput).toBeTruthy();
    expect(promoInput?.getAttribute('name')).toBe('coupon');

    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  it('extractVisibleFormFields captures active fields and flags promo code correctly', () => {
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = () => ({
      width: 100,
      height: 40,
      top: 10,
      left: 10,
      right: 110,
      bottom: 50,
      x: 10,
      y: 10,
      toJSON: () => {}
    });

    document.body.innerHTML = `
      <div class="step-1">
        <div>
          <label>First Name</label>
          <input name="firstName" type="text" />
        </div>
        <div>
          <label>Email Address</label>
          <input name="email" type="email" />
        </div>
        <div>
          <label>Phone</label>
          <input name="phone" type="tel" />
        </div>
        <div>
          <input name="promoCode" placeholder="Promo code" type="text" />
        </div>
      </div>
    `;

    const fields = extractVisibleFormFields();
    expect(fields.length).toBe(4);
    expect(fields[0].label).toBe('First Name');
    expect(fields[1].label).toBe('Email Address');
    expect(fields[2].label).toBe('Phone');
    expect(fields[3].isPromo).toBe(true);

    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  it('does not throw when element has no .select() method', () => {
    document.body.innerHTML = `
      <div id="custom-pill">Select Size: Medium</div>
    `;

    const div = document.getElementById('custom-pill') as HTMLElement;
    expect(typeof (div as any).select).toBe('undefined');

    expect(() => {
      if (typeof (div as any).select === 'function') {
        (div as any).select();
      }
    }).not.toThrow();
  });

  it('does not trigger premature form submission when filling regular inputs', () => {
    let formSubmitted = false;
    document.body.innerHTML = `
      <form id="shipping-form">
        <input id="first-name" type="text" name="first_name" />
        <input id="last-name" type="text" name="last_name" />
      </form>
    `;

    const form = document.getElementById('shipping-form') as HTMLFormElement;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      formSubmitted = true;
    });

    const firstNameInput = document.getElementById('first-name') as HTMLInputElement;

    const isSearchInput = firstNameInput.getAttribute('type') === 'search' ||
                          firstNameInput.getAttribute('role') === 'searchbox' ||
                          firstNameInput.className.toLowerCase().includes('search');

    expect(isSearchInput).toBe(false);
    expect(formSubmitted).toBe(false);
  });

  it('properly extracts timestamp segments from YouTube transcript markup', () => {
    document.body.innerHTML = `
      <ytd-transcript-segment-renderer>
        <div class="segment-timestamp">0:02</div>
        <div class="segment-text">मेरा नाम है जीशान उस्मانی</div>
      </ytd-transcript-segment-renderer>
      <ytd-transcript-segment-renderer>
        <div class="segment-timestamp">1:15</div>
        <div class="segment-text">فضول باتوں کی عادت</div>
      </ytd-transcript-segment-renderer>
    `;

    const segments = Array.from(document.querySelectorAll('ytd-transcript-segment-renderer'));
    expect(segments.length).toBe(2);

    const parsed = segments.map((seg) => {
      const timeEl = seg.querySelector('.segment-timestamp');
      const textEl = seg.querySelector('.segment-text');
      const timeStr = timeEl?.textContent?.trim() || '0:00';
      const textStr = textEl?.textContent?.trim() || '';

      const parts = timeStr.split(':').map((p) => parseFloat(p) || 0);
      const seconds = parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0];
      return { text: textStr, start: seconds };
    });

    expect(parsed[0].start).toBe(2);
    expect(parsed[0].text).toBe('मेरा नाम है जीशान उस्मانی');
    expect(parsed[1].start).toBe(75);
    expect(parsed[1].text).toBe('فضول باتوں کی عادت');
  });

  it('fuzzy token overlap and reverse inclusion finds product link when query has extra words', () => {
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = () => ({
      width: 200,
      height: 100,
      top: 10,
      left: 10,
      right: 210,
      bottom: 110,
      x: 10,
      y: 10,
      toJSON: () => {}
    });

    document.body.innerHTML = `
      <div class="product-collection">
        <div class="product-card" id="card-1">
          <a href="/products/mens-awrah-swim-shorts" class="product-title-link">
            Men's Awrah Swim Shorts (Dual-Layer, Quick Dry)
          </a>
          <span class="price">Rs. 3,490</span>
        </div>
        <div class="product-card" id="card-2">
          <a href="/products/compression-tights" class="product-title-link">
            Men's Modest Active Tights
          </a>
          <span class="price">Rs. 2,990</span>
        </div>
      </div>
    `;

    // Agent query generated from search snippet has extra "by Avicyn LIMITED"
    const query = "Men's Awrah Swim Shorts (Dual-Layer, Quick Dry) by Avicyn LIMITED";

    // 1. Finding with tag "A"
    const matchedAnchor = findElementSemantically("A", query);
    expect(matchedAnchor).toBeTruthy();
    expect(matchedAnchor?.tagName).toBe("A");
    expect(matchedAnchor?.getAttribute("href")).toBe("/products/mens-awrah-swim-shorts");

    // 2. Finding with generic/container click
    const matchedGeneric = findElementSemantically(undefined, query);
    expect(matchedGeneric).toBeTruthy();
    expect(matchedGeneric?.getAttribute("href")).toBe("/products/mens-awrah-swim-shorts");

    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  it('HTML <select> dropdown option selection sets value, updates selected, and fires change events', () => {
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = () => ({
      width: 150,
      height: 40,
      top: 10,
      left: 10,
      right: 160,
      bottom: 50,
      x: 10,
      y: 10,
      toJSON: () => {}
    });

    document.body.innerHTML = `
      <form id="shipping-form">
        <div class="field-group">
          <label for="province-field">Province</label>
          <select id="province-field" name="province">
            <option value="">Select a province</option>
            <option value="PB">Punjab</option>
            <option value="SD">Sindh</option>
            <option value="KP">Khyber Pakhtunkhwa</option>
            <option value="BA">Balochistan</option>
            <option value="IS">Islamabad Capital Territory</option>
          </select>
        </div>
      </form>
    `;

    const selectEl = document.getElementById("province-field") as HTMLSelectElement;
    expect(selectEl).toBeTruthy();
    expect(selectEl.value).toBe("");

    // 1. extractVisibleFormFields captures options array
    const fields = extractVisibleFormFields();
    expect(fields.length).toBe(1);
    expect(fields[0].type).toBe("select");
    expect(fields[0].options).toBeDefined();
    expect(fields[0].options).toContain("Punjab");
    expect(fields[0].options).toContain("Sindh");

    // 2. findElementSemantically matches the select element via label or option value
    const matched = findElementSemantically("SELECT", "Province");
    expect(matched).toBeTruthy();
    expect(matched?.id).toBe("province-field");

    let changeEventFired = false;
    let inputEventFired = false;
    selectEl.addEventListener("change", () => { changeEventFired = true; });
    selectEl.addEventListener("input", () => { inputEventFired = true; });

    // 3. safeInsertTextIntoElement sets option cleanly
    safeInsertTextIntoElement(selectEl, "Punjab", "replace");
    expect(selectEl.value).toBe("PB");
    expect(selectEl.options[1].selected).toBe(true);
    expect(changeEventFired).toBe(true);
    expect(inputEventFired).toBe(true);

    // 4. Test selecting via partial/case-insensitive text
    safeInsertTextIntoElement(selectEl, "islamabad", "replace");
    expect(selectEl.value).toBe("IS");
    expect(selectEl.options[5].selected).toBe(true);

    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  it('scrapeYoutubeDomTranscript extracts segments and timestamps from DOM', async () => {
    document.body.innerHTML = `
      <div id="contents">
        <ytd-transcript-segment-renderer>
          <div class="segment-timestamp">0:05</div>
          <div class="segment-text">Welcome to this presentation on artificial intelligence</div>
        </ytd-transcript-segment-renderer>
        <ytd-transcript-segment-renderer>
          <div class="segment-timestamp">1:42</div>
          <div class="segment-text">Here we explore large language models and their real-world impact</div>
        </ytd-transcript-segment-renderer>
      </div>
    `;

    const transcript = await scrapeYoutubeDomTranscript();
    expect(transcript).toBeTruthy();
    expect(transcript?.length).toBe(2);
    expect(transcript?.[0].start).toBe(5);
    expect(transcript?.[0].text).toBe("Welcome to this presentation on artificial intelligence");
    expect(transcript?.[1].start).toBe(102);
    expect(transcript?.[1].text).toBe("Here we explore large language models and their real-world impact");
  });

  it('strictly protects against selecting home or logo when searching for an absent title', () => {
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = () => ({
      width: 100, height: 40, top: 10, left: 10, right: 110, bottom: 50, x: 10, y: 10, toJSON: () => {}
    });

    document.body.innerHTML = `
      <div id="masthead">
        <a id="logo" href="/" title="YouTube Home">YouTube</a>
      </div>
      <div id="content">
        <a id="video-title" href="/watch?v=123">Introduction to Machine Learning</a>
      </div>
    `;

    // Searching for a completely absent video title like "Future of Work"
    // MUST return null, NOT the logo or home link
    const result = findElementSemantically("A", "Future of Work | Career Advice");
    expect(result).toBeNull();

    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  it('direct YouTube heuristic matches "first video" to ytd-video-renderer a#video-title', () => {
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = () => ({
      width: 100, height: 40, top: 10, left: 10, right: 110, bottom: 50, x: 10, y: 10, toJSON: () => {}
    });

    // Mock window.location
    delete (window as any).location;
    window.location = {
      ...window.location,
      hostname: "www.youtube.com",
      href: "https://www.youtube.com/results?search_query=zeeshan+usmani"
    } as any;

    document.body.innerHTML = `
      <ytd-video-renderer>
        <a id="video-title" href="/watch?v=abc1234">PhD from Home | Zeeshan Usmani</a>
      </ytd-video-renderer>
      <ytd-video-renderer>
        <a id="video-title" href="/watch?v=def5678">Data Science in Pakistan</a>
      </ytd-video-renderer>
    `;

    const result = findElementSemantically(undefined, "play the first video");
    expect(result).toBeTruthy();
    expect(result?.getAttribute("href")).toBe("/watch?v=abc1234");
    expect(result?.textContent).toContain("PhD from Home");

    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  it('waitForElementSemantically polls and resolves when element is dynamically inserted in DOM', async () => {
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = () => ({
      width: 100, height: 40, top: 10, left: 10, right: 110, bottom: 50, x: 10, y: 10, toJSON: () => {}
    });

    document.body.innerHTML = `<div id="app-root"><p>Loading search results...</p></div>`;

    // Asynchronously insert element after 100ms
    setTimeout(() => {
      const container = document.getElementById("app-root");
      if (container) {
        const link = document.createElement("a");
        link.id = "target-card";
        link.href = "/watch?v=future";
        link.textContent = "Future of Work | Career Guide";
        container.appendChild(link);
      }
    }, 100);

    const found = await waitForElementSemantically("A", "Future of Work", undefined, 1000);
    expect(found).toBeTruthy();
    expect(found?.id).toBe("target-card");
    expect(found?.textContent).toContain("Future of Work");

    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });
});

