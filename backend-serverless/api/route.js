const { app, initialize } = require('../server');

module.exports = async (request, response) => {
  try {
    const requestUrl = new URL(request.url, `https://${request.headers.host || 'localhost'}`);
    const originalPath = requestUrl.searchParams.get('__originalPath');
    if (originalPath !== null) {
      requestUrl.searchParams.delete('__originalPath');
      const normalizedPath = originalPath.startsWith('/') ? originalPath : `/${originalPath}`;
      request.url = `/api${normalizedPath}${requestUrl.search}`;
    }

    await initialize();
    return app(request, response);
  } catch (error) {
    console.error('No se pudo preparar la base de datos de PetNica:', error);
    return response.status(503).json({
      error: 'El backend no está disponible por un problema de configuración o base de datos.',
    });
  }
};
