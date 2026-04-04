function safeBtoa(str) {
  try {
    return btoa(
      encodeURIComponent(str).replace(
        /%([0-9A-F]{2})/g,
        function (match, p1) {
          return String.fromCharCode("0x" + p1);
        }
      )
    );
  } catch (e) {
    console.error("Base64 encoding failed:", e);
    throw e;
  }
}

// Collapsible Logic
var coll = document.getElementsByClassName("collapsible");
var i;

for (i = 0; i < coll.length; i++) {
  coll[i].addEventListener("click", function () {
    this.classList.toggle("active");
    var content = this.nextElementSibling;
    if (content.style.maxHeight) {
      content.style.maxHeight = null;
    } else {
      content.style.maxHeight = content.scrollHeight + "px";
    }
  });
}

// Dynamic URL Input Logic
const container = document.getElementById("upstreamUrlContainer");
const addBtn = document.getElementById("addUrlBtn");

function cleanUrl(url) {
  let cleaned = url.trim();
  if (!cleaned) return "";

  // Fix protocol
  if (cleaned.startsWith("stremio://"))
    cleaned = cleaned.replace("stremio://", "https://");
  else if (cleaned.startsWith("stremios://"))
    cleaned = cleaned.replace("stremios://", "https://");
  else if (!cleaned.startsWith("http")) cleaned = "https://" + cleaned;

  // Remove manifest.json and trailing slashes
  // Matches /manifest.json with optional trailing slash
  cleaned = cleaned.replace(/\/manifest\.json\/?$/, "");

  // Remove trailing slash if it exists after removing manifest
  if (cleaned.endsWith("/")) cleaned = cleaned.slice(0, -1);

  return cleaned;
}

function addUrlInput(value = "", applyFilter = true, directLink = false) {
  const div = document.createElement("div");
  div.className = "url-input-group";

  // Row 1: URL input + remove button
  const inputRow = document.createElement("div");
  inputRow.className = "url-input-row";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "url-input-field";
  input.placeholder = "https://torrentio.strem.fun/...";
  input.value = value;

  // Auto-clean on blur
  input.addEventListener("blur", function () {
    const cleaned = cleanUrl(this.value);
    if (cleaned && cleaned !== this.value) {
      this.value = cleaned;
    }
  });

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "remove-btn";
  removeBtn.innerHTML = "&times;"; // Multiplication sign as X
  removeBtn.onclick = function () {
    container.removeChild(div);
  };

  inputRow.appendChild(input);
  inputRow.appendChild(removeBtn);

  // Row 2: Filter checkbox + Direct link checkbox
  const filterRow = document.createElement("div");
  filterRow.className = "url-filter-row";

  // Filter checkbox
  const filterLabel = document.createElement("label");
  const filterCheckbox = document.createElement("input");
  filterCheckbox.type = "checkbox";
  filterCheckbox.className = "url-filter-checkbox";
  filterCheckbox.checked = applyFilter;

  filterLabel.appendChild(filterCheckbox);
  filterLabel.appendChild(
    document.createTextNode(" Apply global filters")
  );
  filterRow.appendChild(filterLabel);

  // Direct link checkbox
  const directLabel = document.createElement("label");
  directLabel.className = "direct-link-label";
  const directCheckbox = document.createElement("input");
  directCheckbox.type = "checkbox";
  directCheckbox.className = "url-direct-checkbox";
  directCheckbox.checked = directLink;

  directLabel.appendChild(directCheckbox);
  directLabel.appendChild(document.createTextNode(" Use direct link"));
  filterRow.appendChild(directLabel);

  div.appendChild(inputRow);
  div.appendChild(filterRow);
  container.appendChild(div);
}

addBtn.addEventListener("click", () => addUrlInput());

// Parse existing config from URL if present
function safeAtob(str) {
  try {
    // Handle URL safe base64
    let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
    // Add padding if needed
    while (base64.length % 4) {
      base64 += "=";
    }
    const decoded = atob(base64);
    // Decode URI components for Unicode support
    return decodeURIComponent(
      decoded
        .split("")
        .map(function (c) {
          return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
        })
        .join("")
    );
  } catch (e) {
    console.error("Base64 decoding failed:", e);
    return null;
  }
}

function loadConfigFromUrl() {
  try {
    const pathParts = window.location.pathname
      .split("/")
      .filter((p) => p);
    console.log("Path parts:", pathParts);

    // Find config string - it's the part that's NOT 'configure' and looks like base64
    let configStr = null;
    for (const part of pathParts) {
      // Skip 'configure' and other known routes
      if (part === "configure" || part === "manifest.json") continue;
      // Config string should be base64-like (alphanumeric, -, _)
      if (/^[A-Za-z0-9_-]+$/.test(part) && part.length > 10) {
        configStr = part;
        break;
      }
    }

    if (configStr) {
      console.log("Found config string:", configStr);
      const decoded = safeAtob(configStr);
      if (decoded) {
        const config = JSON.parse(decoded);
        console.log("Loaded config:", config);

        let configLoaded = false;

        // Pre-fill form fields
        if (config.jacktorr_host) {
          // Handle legacy config with separate port
          let hostValue = config.jacktorr_host;
          if (config.jacktorr_port && config.jacktorr_port !== 0) {
            // Check if host already contains port
            try {
              const url = new URL(hostValue);
              if (!url.port) {
                url.port = config.jacktorr_port;
                hostValue = url.toString().replace(/\/$/, "");
              }
            } catch (e) {
              // If not a valid URL, just append port
              hostValue = `${hostValue}:${config.jacktorr_port}`;
            }
          }
          document.getElementById("jacktorrHost").value = hostValue;
          configLoaded = true;
        }
        if (config.max_streams !== undefined) {
          document.getElementById("maxStreams").value =
            config.max_streams;
          configLoaded = true;
        }
        if (config.tor_fast_sync) {
          document.getElementById("torFastSync").checked = true;
          configLoaded = true;
        }

        // Mediaflow Proxy
        if (config.mediaflow_proxy_url) {
          const el = document.getElementById("mediaflowProxyUrl");
          if (el) el.value = config.mediaflow_proxy_url;
          
          // Enable checkbox and show fields
          const cb = document.getElementById("mediaflowEnabled");
          if (cb) {
              cb.checked = true;
              // Trigger change event to update UI visibility
              cb.dispatchEvent(new Event('change'));
          }
          configLoaded = true;
        }
        if (config.mediaflow_api_password) {
          const el = document.getElementById("mediaflowApiPassword");
          if (el) el.value = config.mediaflow_api_password;
        }
        if (config.mediaflow_public_ip) {
          const el = document.getElementById("mediaflowPublicIp");
          if (el) el.value = config.mediaflow_public_ip;
        }

        // Pre-fill upstream URLs
        if (config.upstream_url) {
          const urls = config.upstream_url
            .split("\n")
            .filter((u) => u.trim());
          const filterFlags = config.upstream_filters || [];
          const directFlags = config.upstream_direct || [];
          if (urls.length > 0) {
            // Clear any existing URLs first
            container.innerHTML = "";
            // Add saved URLs
            urls.forEach((url, idx) => {
              const applyFilter =
                filterFlags.length > idx ? filterFlags[idx] : true;
              const directLink =
                directFlags.length > idx ? directFlags[idx] : false;
              addUrlInput(url, applyFilter, directLink);
            });
            configLoaded = true;
          }
        }

        // Load filters if present
        if (config.filters) {
          loadFilters(config.filters);
          configLoaded = true;
        }

        return configLoaded; // Return true if any config was loaded
      }
    }
  } catch (e) {
    console.error("Error loading config from URL:", e);
  }
  return false; // No config loaded
}

// Helper function to get checked checkbox values
function getCheckedValues(name) {
  const checkboxes = document.querySelectorAll(
    `input[name="${name}"]:checked`
  );
  return Array.from(checkboxes).map((cb) => cb.value);
}

// Helper function to set checkbox values
function setCheckedValues(name, values) {
  if (!values || !Array.isArray(values)) return;
  const checkboxes = document.querySelectorAll(`input[name="${name}"]`);
  checkboxes.forEach((cb) => {
    cb.checked = values.includes(cb.value);
  });
}

// Multi-select component
class MultiSelect {
  constructor(
    element,
    singleSelect = false,
    placeholder = "Select to filter...",
    maxSelection = null
  ) {
    this.element = element;
    this.name = element.dataset.name;
    this.tagsContainer = element.querySelector(".multi-select-tags");
    this.dropdown = element.querySelector(".multi-select-dropdown");
    this.options = element.querySelectorAll(".multi-select-option");
    this.selectedValues = [];
    this.singleSelect = singleSelect;
    this.placeholder = placeholder;
    this.maxSelection = maxSelection;

    this.init();
  }

  init() {
    // Toggle dropdown on click
    this.tagsContainer.addEventListener("click", (e) => {
      if (e.target.classList.contains("multi-select-tag-remove")) return;
      this.toggle();
    });

    // Option click
    this.options.forEach((option) => {
      option.addEventListener("click", () => {
        this.toggleOption(option.dataset.value);
      });
    });

    // Close on outside click
    document.addEventListener("click", (e) => {
      if (!this.element.contains(e.target)) {
        this.close();
      }
    });

    this.render();
  }

  toggle() {
    this.element.classList.toggle("open");
  }

  close() {
    this.element.classList.remove("open");
  }

  toggleOption(value) {
    if (this.singleSelect) {
      // Single select mode - replace value and close dropdown
      this.selectedValues = [value];
      this.render();
      this.close();
    } else {
      // Multi select mode
      const idx = this.selectedValues.indexOf(value);
      if (idx > -1) {
        this.selectedValues.splice(idx, 1);
      } else {
        // Check max selection limit
        if (
          this.maxSelection !== null &&
          this.selectedValues.length >= this.maxSelection
        ) {
          // Auto-remove the first item (FIFO) to allow new selection
          this.selectedValues.shift();
        }
        this.selectedValues.push(value);
      }
      this.render();
    }
  }

  removeValue(value) {
    if (this.singleSelect) return; // Don't allow removal in single select
    const idx = this.selectedValues.indexOf(value);
    if (idx > -1) {
      this.selectedValues.splice(idx, 1);
      this.render();
    }
  }

  setValues(values) {
    if (this.singleSelect && Array.isArray(values)) {
      this.selectedValues = values.length > 0 ? [values[0]] : [];
    } else {
      this.selectedValues = values || [];
      // Enforce max limit on load if needed
      if (
        this.maxSelection !== null &&
        this.selectedValues.length > this.maxSelection
      ) {
        this.selectedValues = this.selectedValues.slice(
          0,
          this.maxSelection
        );
      }
    }
    this.render();
  }

  setValue(value) {
    // Handle single value setting (convert to array)
    this.setValues([value]);
  }

  getValues() {
    return this.selectedValues;
  }

  getValue() {
    // For backward compatibility / single value
    return this.selectedValues.length > 0 ? this.selectedValues[0] : null;
  }

  render() {
    // Update tags
    this.tagsContainer.innerHTML = "";

    if (this.selectedValues.length === 0) {
      const placeholder = document.createElement("span");
      placeholder.className = "multi-select-placeholder";
      placeholder.textContent = this.placeholder || "Select to filter...";
      this.tagsContainer.appendChild(placeholder);
    } else {
      this.selectedValues.forEach((value, index) => {
        const option = this.element.querySelector(
          `[data-value="${value}"]`
        );
        if (option) {
          const tag = document.createElement("span");
          tag.className = "multi-select-tag";

          let content = option.textContent;
          // If maxSelection is active (like sorting), show number
          if (this.maxSelection !== null && !this.singleSelect) {
            content = `${index + 1}. ${content}`;
          }

          if (this.singleSelect) {
            // Single select - no remove button
            tag.textContent = content;
          } else {
            // Multi select - with remove button
            tag.innerHTML = `${content} <span class="multi-select-tag-remove" data-value="${value}">×</span>`;
            tag
              .querySelector(".multi-select-tag-remove")
              .addEventListener("click", (e) => {
                e.stopPropagation();
                this.removeValue(value);
              });
          }
          this.tagsContainer.appendChild(tag);
        }
      });
    }

    // Update options
    this.options.forEach((option) => {
      const val = option.dataset.value;
      const idx = this.selectedValues.indexOf(val);
      if (idx > -1) {
        option.classList.add("selected");
        // Also show number in dropdown if sorting
        if (this.maxSelection !== null && !this.singleSelect) {
          option.setAttribute("data-order", idx + 1);
        }
      } else {
        option.classList.remove("selected");
        option.removeAttribute("data-order");
      }
    });
  }
}

// Initialize multi-selects
const multiSelects = {};
document.querySelectorAll(".multi-select").forEach((el) => {
  let isSingleSelect = false;
  let maxSelection = null;
  let placeholder = "Select to filter...";

  if (el.id === "sortBySelect") {
    isSingleSelect = false; // Changed to multi
    maxSelection = 2; // Max 2
    placeholder = "Select sort order (max 2)...";
  }

  if (el.id === "languageSelect") {
    placeholder = "All languages (select to filter)";
  }
  multiSelects[el.id] = new MultiSelect(
    el,
    isSingleSelect,
    placeholder,
    maxSelection
  );
});

// Set default values
multiSelects.resolutionSelect.setValues(["4k", "1080p"]);
multiSelects.qualitySelect.setValues(["bluray", "webdl"]);
multiSelects.hdrSelect.setValues(["hdr10plus", "hdr10", "hdr", "sdr"]);
multiSelects.languageSelect.setValues([]); // Default: All (empty = no filter)
multiSelects.sortBySelect.setValues(["resolution", "seeders"]);

// 3D filter logic - "Chỉ hiện 3D" only enabled when "Ẩn 3D" is unchecked
const filter3dOnly = document.getElementById("filter3dOnly");
const filterHide3d = document.getElementById("filterHide3d");

filterHide3d.addEventListener("change", function () {
  if (this.checked) {
    filter3dOnly.checked = false;
    filter3dOnly.disabled = true;
    filter3dOnly.parentElement.style.opacity = "0.5";
  } else {
    filter3dOnly.disabled = false;
    filter3dOnly.parentElement.style.opacity = "1";
  }
});

filter3dOnly.addEventListener("change", function () {
  if (this.checked) {
    filterHide3d.checked = false;
  }
});

// Mediaflow Toggle Logic
const mediaflowEnabledCbox = document.getElementById("mediaflowEnabled");
const mediaflowFieldsDiv = document.getElementById("mediaflowFields");

mediaflowEnabledCbox.addEventListener("change", function() {
  mediaflowFieldsDiv.style.display = this.checked ? "block" : "none";
});

function loadFilters(filters) {
  if (!filters) return;
  if (filters.resolution && multiSelects.resolutionSelect) {
    multiSelects.resolutionSelect.setValues(filters.resolution);
  }
  if (filters.quality && multiSelects.qualitySelect) {
    multiSelects.qualitySelect.setValues(filters.quality);
  }
  if (filters.hdr && multiSelects.hdrSelect) {
    multiSelects.hdrSelect.setValues(filters.hdr);
  }
  if (filters.language && multiSelects.languageSelect) {
    multiSelects.languageSelect.setValues(filters.language);
  }
  if (filters.hide3d !== undefined) {
    filterHide3d.checked = filters.hide3d;
    // Update 3D only checkbox state based on hide3d
    if (filters.hide3d) {
      filter3dOnly.checked = false;
      filter3dOnly.disabled = true;
      filter3dOnly.parentElement.style.opacity = "0.5";
    } else {
      filter3dOnly.disabled = false;
      filter3dOnly.parentElement.style.opacity = "1";
      if (filters.show3d !== undefined) {
        filter3dOnly.checked = filters.show3d;
      }
    }
  } else if (filters.show3d !== undefined) {
    filter3dOnly.checked = filters.show3d;
  }
  // Load sort_by
  if (filters.sort_by && multiSelects.sortBySelect) {
    if (Array.isArray(filters.sort_by)) {
      multiSelects.sortBySelect.setValues(filters.sort_by);
    } else {
      multiSelects.sortBySelect.setValue(filters.sort_by);
    }
  }
}

// NOW load config from URL after everything is initialized
if (!loadConfigFromUrl()) {
  addUrlInput(
    "https://torrentio.strem.fun/qualityfilter=dolbyvision,dolbyvisionwithhdr,threed,720p,480p,other,scr,cam,unknown"
  );
}

document
  .getElementById("configForm")
  .addEventListener("submit", function (e) {
    e.preventDefault();
    const statusDiv = document.getElementById("statusMessage");
    statusDiv.innerText = "";

    try {
      // Validate TorrServer Host
      const jacktorrHost = document
        .getElementById("jacktorrHost")
        .value.trim();
      if (!jacktorrHost) {
        statusDiv.innerText =
          "⚠️ Please enter TorrServer Host to continue!";
        statusDiv.style.color = "#f44336";
        document.getElementById("jacktorrHost").focus();
        document.getElementById("jacktorrHost").style.borderColor =
          "#f44336";
        return;
      }

      // Reset border color if valid
      document.getElementById("jacktorrHost").style.borderColor = "#444";
      statusDiv.style.color = "yellow";

      // Collect all URL inputs and their filter/direct states
      const urlGroups = document.querySelectorAll(".url-input-group");
      let urls = [];
      let filterFlags = [];
      let directFlags = [];

      urlGroups.forEach((group) => {
        const input = group.querySelector(".url-input-field");
        const filterCheckbox = group.querySelector(".url-filter-checkbox");
        const directCheckbox = group.querySelector(".url-direct-checkbox");
        
        if (input) {
            const val = cleanUrl(input.value);
            if (val) {
              urls.push(val);
              filterFlags.push(
                filterCheckbox ? filterCheckbox.checked : true
              );
              directFlags.push(
                directCheckbox ? directCheckbox.checked : false
              );
            }
        }
      });

      if (urls.length === 0) {
        // If no valid URLs, maybe warn or allow empty? Let's treat as empty list.
      }

      const upstreamUrlsString = urls.join("\n");

      // Parse credentials from jacktorrHost input
      let finalHost = jacktorrHost;
      let finalPassword = "";
      try {
         // Ensure protocol is present for URL parsing
         const strForUrl = jacktorrHost.includes("://") ? jacktorrHost : "http://" + jacktorrHost;
         const url = new URL(strForUrl);

         if (url.username || url.password) {
             finalPassword = url.password; // Extract password
             finalHost = url.origin; // Use clean origin as host
         }
      } catch (e) {
         // If parsing fails, use original values
      }

      const formData = {
        jacktorr_host: finalHost,
        jacktorr_password: finalPassword,
        upstream_url: upstreamUrlsString,
        upstream_filters: filterFlags,
        upstream_direct: directFlags,
        tor_fast_sync: document.getElementById("torFastSync").checked,
        max_streams:
          parseInt(document.getElementById("maxStreams").value.trim()) ||
          20,
        mediaflow_proxy_url: mediaflowEnabledCbox?.checked && document.getElementById("mediaflowProxyUrl") ? document.getElementById("mediaflowProxyUrl").value.trim() : "",
        mediaflow_api_password: mediaflowEnabledCbox?.checked && document.getElementById("mediaflowApiPassword") ? document.getElementById("mediaflowApiPassword").value.trim() : "",
        mediaflow_public_ip: mediaflowEnabledCbox?.checked && document.getElementById("mediaflowPublicIp") ? document.getElementById("mediaflowPublicIp").value.trim() : "",
        // Global filters
        filters: {
          resolution: multiSelects.resolutionSelect.getValues(),
          quality: multiSelects.qualitySelect.getValues(),
          hdr: multiSelects.hdrSelect.getValues(),
          language: multiSelects.languageSelect.getValues(),
          show3d: filter3dOnly.checked,
          hide3d: filterHide3d.checked,
          sort_by: multiSelects.sortBySelect.getValues(),
        },
      };

      const jsonStr = JSON.stringify(formData);
      const base64Str = safeBtoa(jsonStr)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, ""); // URL safe base64

      const currentHost = window.location.host;
      // Force HTTPS as requested
      const protocol = "https:";

      const installUrl = `${protocol}//${currentHost}/${base64Str}/manifest.json`;

      // Show result
      document.getElementById("generatedLink").value = installUrl;
      document.getElementById("resultArea").style.display = "block";

      // Update install button to use stremio protocol for direct opening
      const stremioUrl = installUrl.replace(/^https?:\/\//, "stremio://");
      const installBtn = document.getElementById("installBtn");
      installBtn.href = stremioUrl;

      // Add click listener to ensure it opens
      installBtn.onclick = function (e) {
        console.log("Opening Stremio URL:", stremioUrl);
      };
    } catch (err) {
      statusDiv.innerText = "Error: " + err.message;
      console.error(err);
    }
  });

document.getElementById("copyBtn").addEventListener("click", function () {
  const copyText = document.getElementById("generatedLink");
  copyText.select();
  copyText.setSelectionRange(0, 99999); // For mobile devices

  // Internal helper to show status
  function showStatus(msg) {
    const status = document.getElementById("statusMessage");
    status.innerText = msg;
    setTimeout(() => {
      status.innerText = "";
    }, 3000);
  }

  // Try modern API first (needs secure context)
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard
      .writeText(copyText.value)
      .then(() => {
        showStatus("Link copied to clipboard!");
      })
      .catch((err) => {
        fallbackCopy();
      });
  } else {
    fallbackCopy();
  }

  function fallbackCopy() {
    try {
      const successful = document.execCommand("copy");
      if (successful) {
        showStatus("Link copied to clipboard!");
      } else {
        showStatus("Failed to copy link.");
      }
    } catch (err) {
      showStatus("Failed to copy link: " + err);
    }
  }
});