// Visper AI: Dedicated E-Commerce & Cart Automation Tool Module
// Supports Shopify, WooCommerce, Daraz, Amazon, Magento, and custom online stores.

export interface EComProductInfo {
  isEComPage: boolean;
  storeType: "shopify" | "woocommerce" | "custom";
  productTitle?: string;
  price?: string;
  availableSizes?: string[];
  inStock?: boolean;
}

export interface EComAddToCartResult {
  success: boolean;
  message: string;
  cartCount?: number;
  cartTotal?: string;
}

/**
  * Auto-detects e-commerce store type and page metadata
  */
export function detectEComContext(): EComProductInfo {
  const isShopify = !!(window as any).Shopify || document.documentElement.outerHTML.includes("cdn.shopify.com");
  const isWoo = document.body.classList.contains("woocommerce") || document.documentElement.outerHTML.includes("woocommerce");

  const titleEl = document.querySelector("h1, .product-title, .product-single__title, .product_title");
  const priceEl = document.querySelector(".price, .product-price, .current-price, .amount");

  const sizeElements = document.querySelectorAll(
    "input[name*='size'], input[name*='option'], select[name*='size'], label[for*='size'], [data-value]"
  );

  const availableSizes: string[] = [];
  sizeElements.forEach(el => {
    const val = (el as HTMLInputElement).value || el.getAttribute("data-value") || el.textContent?.trim() || "";
    if (val && val.length < 15 && !availableSizes.includes(val)) {
      availableSizes.push(val);
    }
  });

  return {
    isEComPage: isShopify || isWoo || !!document.querySelector("form[action*='/cart']"),
    storeType: isShopify ? "shopify" : isWoo ? "woocommerce" : "custom",
    productTitle: titleEl?.textContent?.trim(),
    price: priceEl?.textContent?.trim(),
    availableSizes,
    inStock: !document.body.innerText.toLowerCase().includes("sold out") && !document.body.innerText.toLowerCase().includes("out of stock")
  };
}

/**
  * High-level E-Commerce Add to Cart Executor
  * Strategy A: Direct Store Native API (Shopify /cart/add.js, WooCommerce AJAX)
  * Strategy B: Custom Store DOM Submission Fallback
  */
export async function executeEComAddToCart(variantSize?: string, quantity: number = 1): Promise<EComAddToCartResult> {
  const context = detectEComContext();

  // 1. Shopify Direct Native API Strategy
  if (context.storeType === "shopify") {
    try {
      console.log("Visper ECom: Attempting Shopify native API cart addition...");
      // Find selected variant ID from form input or select
      const variantInput = document.querySelector("form[action*='/cart/add'] input[name='id'], select[name='id']") as HTMLInputElement | HTMLSelectElement;
      let variantId = variantInput?.value;

      // If a size was requested, try selecting the matching size radio/option first
      if (variantSize) {
        selectVariantOption(variantSize);
        await new Promise(r => setTimeout(r, 100));
        variantId = (document.querySelector("form[action*='/cart/add'] input[name='id'], select[name='id']") as HTMLInputElement)?.value || variantId;
      }

      if (variantId) {
        const response = await fetch("/cart/add.js", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: [{ id: parseInt(variantId, 10), quantity }] })
        });

        if (response.ok) {
          const data = await response.json();
          // Fetch updated cart status
          const cartRes = await fetch("/cart.js");
          const cartData = cartRes.ok ? await cartRes.json() : null;

          return {
            success: true,
            message: `Successfully added ${data.items?.[0]?.product_title || "item"} ${variantSize ? `(Size: ${variantSize})` : ""} to your cart via Shopify Store API!`,
            cartCount: cartData?.item_count,
            cartTotal: cartData?.total_price ? `PKR ${(cartData.total_price / 100).toLocaleString()}` : undefined
          };
        }
      }
    } catch (e) {
      console.warn("Shopify API cart addition failed, falling back to DOM form submit:", e);
    }
  }

  // 2. Fallback Strategy: Native Form Submit & DOM Interaction (Custom & WooCommerce Stores)
  try {
    if (variantSize) {
      selectVariantOption(variantSize);
      await new Promise(r => setTimeout(r, 150));
    }

    const cartForm = document.querySelector("form[action*='/cart'], form.cart, form.product-form") as HTMLFormElement;
    const submitBtn = document.querySelector(
      "button[name='add'], button[type='submit'], input[type='submit'], .add-to-cart, .product-form__submit"
    ) as HTMLElement;

    if (cartForm && cartForm.requestSubmit) {
      cartForm.requestSubmit();
      return { success: true, message: `Dispatched form submission for ${variantSize ? `Size ${variantSize}` : "product"}. Check your cart!` };
    } else if (submitBtn) {
      submitBtn.click();
      return { success: true, message: `Clicked Add to Cart button for ${variantSize ? `Size ${variantSize}` : "product"}. Check your cart!` };
    }
  } catch (err: any) {
    return { success: false, message: `Could not submit cart form: ${err.message}` };
  }

  return { success: false, message: "Could not find Add to Cart button or form on this page." };
}

/**
  * Helper to click or select variant size pills / options
  */
function selectVariantOption(targetSize: string): boolean {
  const normalized = targetSize.trim().toLowerCase();
  
  // Try matching inputs, radios, labels, data-values, or select options
  const candidates = document.querySelectorAll(
    "label, input[type='radio'], [data-value], [data-option-value], option"
  );

  for (let i = 0; i < candidates.length; i++) {
    const el = candidates[i] as HTMLElement;
    const txt = el.textContent?.trim().toLowerCase() || "";
    const val = (el as HTMLInputElement).value?.trim().toLowerCase() || el.getAttribute("data-value")?.trim().toLowerCase() || "";

    if (txt === normalized || val === normalized || txt === `size ${normalized}`) {
      if (el.tagName === "OPTION") {
        const select = el.closest("select");
        if (select) {
          select.value = (el as HTMLOptionElement).value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
      } else {
        el.click();
        if (el.tagName === "INPUT") el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
    }
  }
  return false;
}
