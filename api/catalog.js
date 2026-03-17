const WOO_PRODUCTS_ENDPOINT = 'https://divertibici.com.mx/wp-json/wc/store/v1/products';
const BIKES_CATEGORY_ID = '17';
const PRODUCTS_PER_PAGE = '100';

async function fetchProductsPage(page) {
    const endpoint = new URL(WOO_PRODUCTS_ENDPOINT);

    endpoint.searchParams.set('category', BIKES_CATEGORY_ID);
    endpoint.searchParams.set('per_page', PRODUCTS_PER_PAGE);
    endpoint.searchParams.set('page', String(page));

    const response = await fetch(endpoint.toString(), {
        headers: {
            Accept: 'application/json',
            'User-Agent': 'TurboBikeCatalog/1.0'
        }
    });

    if (!response.ok) {
        throw new Error('WooCommerce returned ' + response.status);
    }

    const products = await response.json();
    const total = Number(response.headers.get('x-wp-total') || products.length || 0);
    const totalPages = Number(response.headers.get('x-wp-totalpages') || 1);

    return {
        products,
        total,
        totalPages
    };
}

async function fetchCatalog() {
    const firstPage = await fetchProductsPage(1);
    const allProducts = firstPage.products.slice();

    if (firstPage.totalPages > 1) {
        const remainingPages = await Promise.all(
            Array.from({ length: firstPage.totalPages - 1 }, function(_, index) {
                return fetchProductsPage(index + 2);
            })
        );

        remainingPages.forEach(function(page) {
            allProducts.push.apply(allProducts, page.products);
        });
    }

    return {
        source: 'woocommerce',
        categoryId: Number(BIKES_CATEGORY_ID),
        total: allProducts.length || firstPage.total,
        fetchedAt: new Date().toISOString(),
        products: allProducts
    };
}

module.exports = async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=86400');

    try {
        const catalog = await fetchCatalog();

        res.statusCode = 200;
        res.end(JSON.stringify(catalog));
    } catch (error) {
        res.statusCode = 502;
        res.end(JSON.stringify({
            error: 'catalog_fetch_failed',
            message: error.message
        }));
    }
};

module.exports.fetchCatalog = fetchCatalog;
