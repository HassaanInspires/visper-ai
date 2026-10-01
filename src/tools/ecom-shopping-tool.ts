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
  * Dispatches action to the active webpage's content script to execute in page origin context
  */
export async function executeEComAddToCart(
  variantSize?: string, 
  quantity: number = 1,
  sendToTabFn?: (msg: any) => Promise<any>
): Promise<EComAddToCartResult> {
  try {
    let response: any;
    if (sendToTabFn) {
      response = await sendToTabFn({
        type: "ECOM_ADD_TO_CART",
        text: variantSize ? `Size ${variantSize}` : "Add to Cart",
        quantity
      });
    } else {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) throw new Error("No active webpage tab found.");
      response = await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, {
          type: "ECOM_ADD_TO_CART",
          text: variantSize ? `Size ${variantSize}` : "Add to Cart",
          quantity
        }, (res) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(res);
        });
      });
    }

    if (response && response.success) {
      return {
        success: true,
        message: response.message || "Added item to cart successfully."
      };
    }
    return {
      success: false,
      message: response?.error || "Could not add item to cart on this page."
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Failed executing cart action: ${err.message}`
    };
  }
}

/**
  * Helper to click or select variant size pills / options
  */
export function selectVariantOption(targetSize: string): boolean {
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
