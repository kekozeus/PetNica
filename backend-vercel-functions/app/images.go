package app

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// imageStorage replica image-storage.js: Supabase Storage o disco local,
// con el mismo formato de ruta {prefix}/{productId}/{uuid}.{ext}.
type imageStorage struct {
	mode          string // "supabase" | "local"
	supabaseURL   string
	supabaseKey   string
	bucket        string
	encodedBucket string
	publicBase    string
	prefix        string
	imageDir      string
	serverless    bool
	client        *http.Client
}

type storedImage struct {
	driver     string
	objectPath string
	url        string
	filePath   string
}

var prefixPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9/_-]{0,118}$`)

func newImageStorage(cfg config) (*imageStorage, error) {
	prefix := strings.Trim(strings.ReplaceAll(cfg.supabasePrefix, "\\", "/"), "/")
	if !prefixPattern.MatchString(prefix) || strings.Contains(prefix, "..") {
		return nil, fmt.Errorf("SUPABASE_PRODUCT_IMAGE_PREFIX debe ser una ruta segura como \"products\"")
	}
	supabaseConfigured := cfg.supabaseURL != "" && cfg.supabaseKey != "" && cfg.supabaseBucket != ""
	useSupabase := cfg.imageStorageMode == "supabase" || (cfg.imageStorageMode == "auto" && supabaseConfigured)
	if useSupabase && !supabaseConfigured {
		return nil, fmt.Errorf("configura SUPABASE_URL y SUPABASE_SECRET_KEY para usar Supabase Storage")
	}
	if useSupabase {
		parsed, err := url.Parse(cfg.supabaseURL)
		if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") {
			return nil, fmt.Errorf("SUPABASE_URL debe ser una URL HTTP o HTTPS válida")
		}
	}
	imageDir := cfg.imageDir
	if imageDir == "" {
		imageDir = filepath.Join("public", "images")
	}
	abs, err := filepath.Abs(imageDir)
	if err == nil {
		imageDir = abs
	}

	storage := &imageStorage{
		supabaseURL: cfg.supabaseURL,
		supabaseKey: cfg.supabaseKey,
		bucket:      cfg.supabaseBucket,
		prefix:      prefix,
		imageDir:    imageDir,
		serverless:  cfg.serverless,
		client:      &http.Client{},
	}
	if useSupabase {
		storage.mode = "supabase"
		storage.encodedBucket = url.PathEscape(cfg.supabaseBucket)
		storage.publicBase = cfg.supabaseURL + "/storage/v1/object/public/" + storage.encodedBucket + "/"
	} else {
		storage.mode = "local"
	}
	return storage, nil
}

// serveImage replica app.use('/images', express.static(imageDirectory)).
func (a *App) serveImage(w http.ResponseWriter, r *http.Request) {
	name := filepath.Clean("/" + r.PathValue("file"))
	http.ServeFile(w, r, filepath.Join(a.images.imageDir, name))
}

func encodeObjectPath(objectPath string) string {
	parts := strings.Split(objectPath, "/")
	for i, p := range parts {
		parts[i] = url.PathEscape(p)
	}
	return strings.Join(parts, "/")
}

func (s *imageStorage) storageRequest(objectPath, method string, headers map[string]string, body []byte) error {
	endpoint := s.supabaseURL + "/storage/v1/object/" + s.encodedBucket + "/" + encodeObjectPath(objectPath)
	req, err := http.NewRequest(method, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("apikey", s.supabaseKey)
	req.Header.Set("Authorization", "Bearer "+s.supabaseKey)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return errf(http.StatusBadGateway, "No se pudo completar la operación en Supabase Storage.")
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 300))
		fmt.Printf("Supabase Storage respondió %d: %s\n", resp.StatusCode, string(detail))
		return errf(http.StatusBadGateway, "No se pudo completar la operación en Supabase Storage.")
	}
	return nil
}

func (s *imageStorage) save(productID string, buffer []byte, imgType imageTypeInfo) (*storedImage, error) {
	objectPath := fmt.Sprintf("%s/%s/%s.%s", s.prefix, productID, newUUID(), imgType.extension)
	if s.mode == "supabase" {
		err := s.storageRequest(objectPath, http.MethodPost, map[string]string{
			"Content-Type":  imgType.mime,
			"cache-control": "max-age=31536000",
			"x-upsert":      "false",
		}, buffer)
		if err != nil {
			return nil, err
		}
		return &storedImage{
			driver:     "supabase",
			objectPath: objectPath,
			url:        s.publicBase + encodeObjectPath(objectPath),
		}, nil
	}
	if s.serverless {
		return nil, errf(http.StatusServiceUnavailable, "Configura Supabase Storage para subir imágenes en producción.")
	}
	filePath := filepath.Join(s.imageDir, filepath.FromSlash(objectPath))
	if err := os.MkdirAll(filepath.Dir(filePath), 0o755); err != nil {
		return nil, err
	}
	flag := os.O_WRONLY | os.O_CREATE | os.O_EXCL
	file, err := os.OpenFile(filePath, flag, 0o644)
	if err != nil {
		return nil, err
	}
	if _, err := file.Write(buffer); err != nil {
		file.Close()
		return nil, err
	}
	if err := file.Close(); err != nil {
		return nil, err
	}
	return &storedImage{driver: "local", filePath: filePath, objectPath: objectPath, url: "/images/" + objectPath}, nil
}

func (s *imageStorage) remove(stored *storedImage) error {
	if stored == nil {
		return nil
	}
	if stored.driver == "supabase" {
		return s.storageRequest(stored.objectPath, http.MethodDelete, nil, nil)
	}
	return os.Remove(stored.filePath)
}

// localPathFromUrl replica la resolución segura de rutas locales del JS.
func (s *imageStorage) localPathFromUrl(rawURL string) string {
	if rawURL == "" || !strings.HasPrefix(rawURL, "/images/") {
		return ""
	}
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	relative, err := url.PathUnescape(parsed.Path[len("/images/"):])
	if err != nil || relative == "" || strings.Contains(relative, "..") || filepath.IsAbs(relative) {
		return ""
	}
	if !strings.HasPrefix(relative, s.prefix+"/") && !strings.HasPrefix(relative, "products/") && !strings.HasPrefix(relative, "admin-") {
		return ""
	}
	filePath := filepath.Join(s.imageDir, filepath.FromSlash(relative))
	root := s.imageDir
	if !strings.HasPrefix(filePath, root+string(filepath.Separator)) {
		return ""
	}
	return filePath
}

func (s *imageStorage) supabasePathFromUrl(rawURL string) string {
	if rawURL == "" || !strings.HasPrefix(rawURL, s.publicBase) {
		return ""
	}
	encoded := strings.SplitN(strings.SplitN(rawURL[len(s.publicBase):], "#", 2)[0], "?", 2)[0]
	if encoded == "" {
		return ""
	}
	objectPath, err := url.PathUnescape(encoded)
	if err != nil {
		return ""
	}
	if !strings.HasPrefix(objectPath, s.prefix+"/") || strings.Contains(objectPath, "..") {
		return ""
	}
	return objectPath
}

func (s *imageStorage) removeByURL(rawURL string) (bool, error) {
	if s.mode == "supabase" {
		if objectPath := s.supabasePathFromUrl(rawURL); objectPath != "" {
			if err := s.storageRequest(objectPath, http.MethodDelete, nil, nil); err != nil {
				return false, err
			}
			return true, nil
		}
	}
	filePath := s.localPathFromUrl(rawURL)
	if filePath == "" {
		return false, nil
	}
	if err := os.Remove(filePath); err != nil {
		return false, err
	}
	return true, nil
}
