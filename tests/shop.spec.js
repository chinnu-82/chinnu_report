// @ts-check
const { test, expect } = require('../src');

// The demo shop is served by demo-app/server.js — see webServer in playwright.config.js.
const APP = '/';

async function login(page, report) {
  await report.step('Open the store', async () => {
    await page.goto(APP);
  });
  await report.step('Sign in as a returning customer', async () => {
    await page.getByLabel('Email').fill('ada@nimbus.test');
    await page.getByLabel('Password').fill('secret');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('ada@nimbus.test')).toBeVisible();
  });
}

test.describe('Authentication', () => {
  test('customer can sign in @smoke', async ({ page, report }) => {
    report.severity('critical');
    report.owner('Checkout team');
    report.feature('Login');
    report.description('A returning customer signs in with email and password and lands on the product catalogue.');

    await login(page, report);
    await report.step('Product catalogue is shown', async () => {
      await expect(page.getByTestId('product')).toHaveCount(6);
    }, { highlight: page.locator('#products') });
  });

  test('wrong password shows a helpful error', async ({ page, report }) => {
    report.feature('Login');
    await report.step('Open the store', () => page.goto(APP));
    await report.step('Try to sign in with a wrong password', async () => {
      await page.getByLabel('Email').fill('ada@nimbus.test');
      await page.getByLabel('Password').fill('nope');
      await page.getByRole('button', { name: 'Sign in' }).click();
    });
    await report.step('Error message is visible', async () => {
      await expect(page.getByText('Invalid email or password')).toBeVisible();
    }, { highlight: page.locator('#login-error') });
  });
});

test.describe('Shopping', () => {
  test('search narrows the catalogue @smoke', async ({ page, report }) => {
    report.feature('Search');
    await login(page, report);
    await report.step('Search for "mug"', async () => {
      await page.getByLabel('Search products').fill('mug');
    });
    report.note('Search is case-insensitive, so "mug" should match "Storm Mug".');
    await report.step('Only the Storm Mug is listed', async () => {
      await expect(page.getByTestId('product')).toHaveCount(1);
      await expect(page.getByTestId('product')).toContainText('Storm Mug');
    });
  });

  test('coupon SAVE10 takes $10 off the order', async ({ page, report }) => {
    report.severity('high');
    report.feature('Checkout');
    report.issue('SHOP-142');

    await login(page, report);
    await report.step('Add a hoodie and a mug to the cart', async () => {
      await page.getByRole('button', { name: 'Add to cart' }).nth(0).click();
      await page.getByRole('button', { name: 'Add to cart' }).nth(1).click();
      await expect(page.getByTestId('cart-button')).toContainText('2');
    });
    await report.step('Go to checkout', async () => {
      await page.getByTestId('cart-button').click();
    });
    await report.attach('Order under test', { items: ['Cloud Hoodie', 'Storm Mug'], subtotal: 85, coupon: 'SAVE10' });

    await report.check('Subtotal is $85 before the coupon', async () => {
      await expect(page.getByTestId('total')).toHaveText('$85');
    });
    await report.step('Apply coupon SAVE10', async () => {
      await page.getByPlaceholder('Coupon code').fill('SAVE10');
      await page.getByRole('button', { name: 'Apply coupon' }).click();
    });
    await report.step('Total shows the discount', async () => {
      await expect(page.getByTestId('total')).toHaveText('$75', { timeout: 2000 });
    }, { highlight: page.getByTestId('total') });
  });

  test('customer can track their order', async ({ page, report }) => {
    report.feature('Orders');
    await login(page, report);
    await report.step('Open order tracking', async () => {
      await page.getByRole('button', { name: 'Track order' }).click({ timeout: 3000 });
    });
  });

  test('payment widget loads without errors', async ({ page, report }) => {
    report.feature('Checkout');
    await login(page, report);
    await report.step('Add Rainbow Socks and check out', async () => {
      await page.getByRole('button', { name: 'Add to cart' }).nth(2).click();
      await page.getByTestId('cart-button').click();
    });
    await report.step('Press "Pay now"', async () => {
      await page.getByRole('button', { name: 'Pay now' }).click();
      await page.waitForTimeout(200);
    });
    await report.screenshot('Checkout after paying', { highlight: page.getByTestId('checkout') });
    report.note('The uncaught PaymentWidget error is captured automatically in Browser diagnostics.', 'warn');
  });

  test('a failing recommendations API is reported with its request and response', async ({ page, report }) => {
    report.feature('Recommendations');
    report.severity('high');

    report.note('The demo server answers /api/recommendations with a 500 on purpose.');
    await login(page, report);
    await report.step('Ask for a suggestion', async () => {
      await page.getByRole('button', { name: 'Suggest something for me' }).click();
    });
    await report.step('The shop apologises instead of breaking', async () => {
      await expect(page.getByText('could not load suggestions')).toBeVisible();
    }, { highlight: page.locator('#suggest-error') });

    report.note('The failed POST — its payload and the 500 response body — is in Browser diagnostics. The analytics call is excluded by aurora.config.js.', 'warn');
  });

  test('toast confirms item was added', async ({ page, report }, testInfo) => {
    report.feature('Cart');
    await login(page, report);
    await report.step('Add Thunder Cap to the cart', async () => {
      await page.getByRole('button', { name: 'Add to cart' }).nth(3).click();
    });
    await report.step('Confirmation toast appears', async () => {
      // Simulates a race condition: the first attempt checks too late, after the toast is gone.
      if (testInfo.retry === 0) await page.waitForTimeout(1700);
      await expect(page.getByText('Added to cart')).toBeVisible({ timeout: 500 });
    });
  });

  test('gift wrapping option', async ({ page }) => {
    test.skip(true, 'Gift wrapping ships in release 2.4');
    await page.goto(APP);
  });
});

test.describe('Without the report fixture', () => {
  test('plain Playwright steps still tell a story', async ({ page }) => {
    await test.step('Open the store', async () => {
      await page.goto(APP);
    });
    await test.step('Sign-in form is visible', async () => {
      await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
      await expect(page.getByLabel('Email')).toBeEditable();
    });
  });
});
