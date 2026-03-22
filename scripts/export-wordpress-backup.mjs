import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const WOO_PRODUCTS_ENDPOINT = 'https://divertibici.com.mx/wp-json/wc/store/v1/products';
const BIKES_CATEGORY_ID = '17';
const PRODUCTS_PER_PAGE = '100';
const USER_AGENT = 'DivertiBiciBackup/1.0';

const projectRoot = process.cwd();
const backupDir = path.join(projectRoot, 'backup');
const imageRootDir = path.join(backupDir, 'images');
const catalogPath = path.join(backupDir, 'woocommerce-catalog.json');
const manifestPath = path.join(backupDir, 'manifest.json');

async function fetchProductsPage(page) {
    const endpoint = new URL(WOO_PRODUCTS_ENDPOINT);

    endpoint.searchParams.set('category', BIKES_CATEGORY_ID);
    endpoint.searchParams.set('per_page', PRODUCTS_PER_PAGE);
    endpoint.searchParams.set('page', String(page));

    const response = await fetch(endpoint, {
        headers: {
            Accept: 'application/json',
            'User-Agent': USER_AGENT
        }
    });

    if (!response.ok) {
        throw new Error('WooCommerce returned ' + response.status + ' for page ' + page);
    }

    const products = await response.json();
    const totalPages = Number(response.headers.get('x-wp-totalpages') || 1);
    const total = Number(response.headers.get('x-wp-total') || products.length || 0);

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
        source: 'wordpress-backup',
        categoryId: Number(BIKES_CATEGORY_ID),
        total: allProducts.length || firstPage.total,
        fetchedAt: new Date().toISOString(),
        products: allProducts
    };
}

function getImageRelativePath(urlValue) {
    if (!urlValue) {
        return null;
    }

    const imageUrl = new URL(urlValue);
    const pathname = imageUrl.pathname.replace(/^\/+/, '');
    const safePath = pathname
        .split('/')
        .map(function(segment) {
            return segment
                .normalize('NFKD')
                .replace(/[^\w.-]+/g, '-')
                .replace(/-+/g, '-')
                .replace(/^-+|-+$/g, '') || 'asset';
        })
        .join('/');

    return safePath;
}

function getPublicImagePath(relativePath) {
    return '/backup/images/' + relativePath.split(path.sep).join('/');
}

async function downloadImage(urlValue, relativePath) {
    const destinationPath = path.join(imageRootDir, relativePath);
    const response = await fetch(urlValue, {
        headers: {
            Accept: '*/*',
            'User-Agent': USER_AGENT
        }
    });

    if (!response.ok) {
        throw new Error('Image download failed with ' + response.status + ' for ' + urlValue);
    }

    const arrayBuffer = await response.arrayBuffer();

    await mkdir(path.dirname(destinationPath), { recursive: true });
    await writeFile(destinationPath, Buffer.from(arrayBuffer));

    return destinationPath;
}

function collectImageUrls(products) {
    const imageUrlMap = new Map();

    products.forEach(function(product) {
        (Array.isArray(product.images) ? product.images : []).forEach(function(image) {
            [image.src, image.thumbnail].forEach(function(urlValue) {
                if (!urlValue || imageUrlMap.has(urlValue)) {
                    return;
                }

                const relativePath = getImageRelativePath(urlValue);

                if (relativePath) {
                    imageUrlMap.set(urlValue, relativePath);
                }
            });
        });
    });

    return imageUrlMap;
}

function localizeProducts(products, imageUrlMap) {
    return products.map(function(product) {
        return Object.assign({}, product, {
            images: (Array.isArray(product.images) ? product.images : []).map(function(image) {
                const localizedSource = imageUrlMap.get(image.src);
                const localizedThumbnail = imageUrlMap.get(image.thumbnail);

                return Object.assign({}, image, {
                    src: localizedSource ? getPublicImagePath(localizedSource) : image.src,
                    thumbnail: localizedThumbnail
                        ? getPublicImagePath(localizedThumbnail)
                        : localizedSource
                            ? getPublicImagePath(localizedSource)
                            : image.thumbnail,
                    original_src: image.src,
                    original_thumbnail: image.thumbnail
                });
            })
        });
    });
}

async function main() {
    await mkdir(imageRootDir, { recursive: true });

    const catalog = await fetchCatalog();
    const imageUrlMap = collectImageUrls(catalog.products);
    const uniqueImages = Array.from(imageUrlMap.entries());

    for (const [urlValue, relativePath] of uniqueImages) {
        await downloadImage(urlValue, relativePath);
    }

    const localizedCatalog = Object.assign({}, catalog, {
        backupCreatedAt: new Date().toISOString(),
        imageCount: uniqueImages.length,
        products: localizeProducts(catalog.products, imageUrlMap)
    });

    const manifest = {
        source: localizedCatalog.source,
        categoryId: localizedCatalog.categoryId,
        fetchedAt: localizedCatalog.fetchedAt,
        backupCreatedAt: localizedCatalog.backupCreatedAt,
        productCount: localizedCatalog.total,
        imageCount: uniqueImages.length
    };

    await writeFile(catalogPath, JSON.stringify(localizedCatalog, null, 2) + '\n');
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

    console.log(JSON.stringify(manifest, null, 2));
}

main().catch(function(error) {
    console.error(error);
    process.exitCode = 1;
});
