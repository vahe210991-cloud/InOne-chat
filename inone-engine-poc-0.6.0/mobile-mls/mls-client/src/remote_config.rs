//! Удалённая конфигурация на клиенте (пункт 11). Умолчания совпадают с сервером (src/flags.js).
//! Приложение работает без связи: без данных берутся умолчания, при сбое сети — последние сохранённые значения.
//! На обслуживании записи не отправляются; сообщения остаются в очереди и уходят после обслуживания.

use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Map, Value};

use crate::{text, Client};

/// Текст, который получает приложение, когда записи отключены на обслуживании.
pub const MAINTENANCE_MESSAGE: &str = "сервис на обслуживании: записи временно отключены";

/// Откуда взяты значения.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    /// Умолчания из кода: с сервером ещё не было ни одного обновления.
    Defaults,
    /// Последние сохранённые значения: сервер не менял их или сейчас недоступен.
    Cached,
    /// Свежие значения с сервера.
    Fresh,
    /// Значения для разработки, заданные в коде.
    Development,
}

/// Значения флагов, которые нужны приложению.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RemoteConfig {
    pub files_enabled: bool,
    pub push_enabled: bool,
    pub edit_window_minutes: u32,
    pub channels_enabled: bool,
    pub group_max_members: u32,
    pub maintenance: bool,
    pub min_version: String,
    pub source: Source,
}

impl RemoteConfig {
    /// Поддерживает ли приложение версии `current` минимальную версию из конфигурации.
    pub fn supports_version(&self, current: &str) -> bool {
        version_at_least(current, &self.min_version)
    }

    /// Умолчания: те же, что на сервере без переопределений.
    pub fn defaults() -> Self {
        Self {
            files_enabled: true,
            push_enabled: true,
            edit_window_minutes: 15,
            channels_enabled: true,
            group_max_members: 500,
            maintenance: false,
            min_version: "0.0.0".to_string(),
            source: Source::Defaults,
        }
    }

    /// Собирает значения из ответа сервера. Каждое значение проверяется отдельно: неверный тип или выход за предел
    /// даёт умолчание для этого ключа, остальные значения не сбрасываются.
    pub fn from_values(values: &Map<String, Value>, source: Source) -> Self {
        let mut c = Self { source, ..Self::defaults() };
        if let Some(v) = values.get("files.enabled").and_then(Value::as_bool) {
            c.files_enabled = v;
        }
        if let Some(v) = values.get("push.enabled").and_then(Value::as_bool) {
            c.push_enabled = v;
        }
        if let Some(v) = values.get("messages.editWindowMinutes").and_then(Value::as_u64) {
            if (1..=1440).contains(&v) {
                c.edit_window_minutes = v as u32;
            }
        }
        if let Some(v) = values.get("channels.enabled").and_then(Value::as_bool) {
            c.channels_enabled = v;
        }
        if let Some(v) = values.get("groups.maxMembers").and_then(Value::as_u64) {
            if (2..=500).contains(&v) {
                c.group_max_members = v as u32;
            }
        }
        if let Some(v) = values.get("maintenance.enabled").and_then(Value::as_bool) {
            c.maintenance = v;
        }
        if let Some(v) = values.get("app.minVersion").and_then(Value::as_str) {
            if is_version(v) {
                c.min_version = v.to_string();
            }
        }
        c
    }

    /// Совпадают ли значения (источник не учитывается).
    pub fn same_values(&self, other: &RemoteConfig) -> bool {
        self.files_enabled == other.files_enabled
            && self.push_enabled == other.push_enabled
            && self.edit_window_minutes == other.edit_window_minutes
            && self.channels_enabled == other.channels_enabled
            && self.group_max_members == other.group_max_members
            && self.maintenance == other.maintenance
            && self.min_version == other.min_version
    }
}

fn is_version(s: &str) -> bool {
    let parts: Vec<&str> = s.split('.').collect();
    parts.len() == 3 && parts.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}

/// Публичная часть конфигурации, которую приложение читает до входа: статус обслуживания и минимальная версия.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PublicStatus {
    pub maintenance: bool,
    pub min_version: String,
}

/// Читает публичную часть без входа в аккаунт. Ошибка значит: связи нет или сервер не ответил. Тогда статус
/// не выдумывается: приложение продолжает обычный путь, а запись сервер сама отклонит, если идёт обслуживание.
pub fn fetch_public_status(base: &str) -> Result<PublicStatus, String> {
    let agent = ureq::AgentBuilder::new().timeout(std::time::Duration::from_secs(10)).build();
    let resp = agent.get(&format!("{base}/config/public")).call().map_err(|e| format!("сеть: {e}"))?;
    let body = resp.into_json::<Value>().map_err(text)?;
    let values = body["flags"].as_object().cloned().unwrap_or_default();
    let c = RemoteConfig::from_values(&values, Source::Fresh);
    Ok(PublicStatus { maintenance: c.maintenance, min_version: c.min_version })
}

/// Версия приложения не ниже минимальной. Сравнение по числам: «1.10.0» новее «1.9.9». Непонятная версия не проходит.
pub fn version_at_least(current: &str, min: &str) -> bool {
    fn parts(s: &str) -> Option<[u32; 3]> {
        if !is_version(s) {
            return None;
        }
        let mut out = [0u32; 3];
        for (i, p) in s.split('.').enumerate() {
            out[i] = p.parse().ok()?;
        }
        Some(out)
    }
    match (parts(current), parts(min)) {
        (Some(c), Some(m)) => c >= m,
        _ => false,
    }
}

/// Служба удалённой конфигурации. Реализации: без связи, для разработки, боевая (с сервером и кэшем).
pub trait RemoteConfigService {
    /// Текущие значения. Не бывает ошибкой: без данных — умолчания.
    fn current(&self) -> RemoteConfig;
    /// Обновление с сервера. Ошибка сети не меняет текущие значения.
    fn refresh(&self) -> Result<RemoteConfig, String>;
}

/// Без связи: всегда умолчания. Для сборок без сервера и для тестов.
pub struct NoOpRemoteConfigService;

impl RemoteConfigService for NoOpRemoteConfigService {
    fn current(&self) -> RemoteConfig {
        RemoteConfig::defaults()
    }

    fn refresh(&self) -> Result<RemoteConfig, String> {
        Ok(RemoteConfig::defaults())
    }
}

/// Для разработки: значения заданы в коде, сеть не нужна.
pub struct DevelopmentRemoteConfigService {
    values: Map<String, Value>,
}

impl DevelopmentRemoteConfigService {
    pub fn new(values: Map<String, Value>) -> Self {
        Self { values }
    }
}

impl RemoteConfigService for DevelopmentRemoteConfigService {
    fn current(&self) -> RemoteConfig {
        RemoteConfig::from_values(&self.values, Source::Development)
    }

    fn refresh(&self) -> Result<RemoteConfig, String> {
        Ok(self.current())
    }
}

/// Боевая: значения с сервера; последние удачные сохраняются в зашифрованной базе устройства.
pub struct ProductionRemoteConfigService<'a> {
    client: &'a Client,
}

impl<'a> ProductionRemoteConfigService<'a> {
    pub fn new(client: &'a Client) -> Self {
        Self { client }
    }
}

impl RemoteConfigService for ProductionRemoteConfigService<'_> {
    fn current(&self) -> RemoteConfig {
        self.client.cached_remote_config()
    }

    fn refresh(&self) -> Result<RemoteConfig, String> {
        self.client.refresh_remote_config()
    }
}

impl Client {
    /// Значения из кэша устройства или умолчания. Сеть не используется.
    pub fn cached_remote_config(&self) -> RemoteConfig {
        match self.load_remote_config_cache() {
            Some((_, values)) => RemoteConfig::from_values(&values, Source::Cached),
            None => RemoteConfig::defaults(),
        }
    }

    /// Обновление с сервера. Если сервер ответил «не менялось», остаются сохранённые значения.
    pub fn refresh_remote_config(&self) -> Result<RemoteConfig, String> {
        let etag = self.load_remote_config_cache().map(|(tag, _)| tag);
        match self.fetch_remote_config(etag.as_deref())? {
            None => Ok(self.cached_remote_config()),
            Some((tag, body)) => {
                let values = body["flags"].as_object().cloned().unwrap_or_default();
                let fetched_at = SystemTime::now().duration_since(UNIX_EPOCH).map_err(text)?.as_millis() as i64;
                self.meta
                    .execute(
                        "INSERT OR REPLACE INTO client_remote_config (id, etag, body, fetched_at) VALUES (1, ?1, ?2, ?3)",
                        (tag, body.to_string(), fetched_at),
                    )
                    .map_err(text)?;
                Ok(RemoteConfig::from_values(&values, Source::Fresh))
            }
        }
    }

    /// На обслуживании записи не отправляются: вызов возвращает понятную ошибку.
    pub(crate) fn ensure_writable(&self) -> Result<(), String> {
        if self.cached_remote_config().maintenance {
            return Err(MAINTENANCE_MESSAGE.to_string());
        }
        Ok(())
    }

    fn load_remote_config_cache(&self) -> Option<(String, Map<String, Value>)> {
        let (tag, body): (String, String) = self
            .meta
            .query_row("SELECT etag, body FROM client_remote_config WHERE id = 1", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .ok()?;
        let parsed: Value = serde_json::from_str(&body).ok()?;
        let values = parsed["flags"].as_object()?.clone();
        Some((tag, values))
    }

    fn fetch_remote_config(&self, etag: Option<&str>) -> Result<Option<(String, Value)>, String> {
        match self.fetch_remote_config_once(etag) {
            Err(e) if e.contains("token_expired") => {
                self.renew()?;
                self.fetch_remote_config_once(etag)
            }
            other => other,
        }
    }

    fn fetch_remote_config_once(&self, etag: Option<&str>) -> Result<Option<(String, Value)>, String> {
        let token = self.tokens.lock().map_err(text)?.0.clone();
        let mut req = self.agent.get(&format!("{}/config", self.base)).set("authorization", &format!("Bearer {token}"));
        if let Some(tag) = etag {
            req = req.set("if-none-match", tag);
        }
        match req.call() {
            Ok(resp) if resp.status() == 304 => Ok(None),
            Ok(resp) => {
                let tag = resp.header("etag").unwrap_or_default().to_string();
                let body = resp.into_json::<Value>().map_err(text)?;
                Ok(Some((tag, body)))
            }
            Err(ureq::Error::Status(304, _)) => Ok(None),
            Err(ureq::Error::Status(code, r)) => Err(format!("GET /config -> {code} {}", r.into_string().unwrap_or_default())),
            Err(e) => Err(format!("сеть: {e}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn values(v: Value) -> Map<String, Value> {
        v.as_object().cloned().unwrap()
    }

    #[test]
    fn defaults_are_the_server_defaults() {
        let d = RemoteConfig::defaults();
        assert!(d.files_enabled && d.push_enabled && d.channels_enabled);
        assert_eq!(d.edit_window_minutes, 15);
        assert_eq!(d.group_max_members, 500);
        assert!(!d.maintenance);
        assert_eq!(d.min_version, "0.0.0");
        assert_eq!(d.source, Source::Defaults);
    }

    #[test]
    fn values_from_the_server_are_read() {
        let c = RemoteConfig::from_values(
            &values(json!({"groups.maxMembers": 42, "maintenance.enabled": true, "app.minVersion": "1.2.3", "messages.editWindowMinutes": 30})),
            Source::Fresh,
        );
        assert_eq!(c.group_max_members, 42);
        assert!(c.maintenance);
        assert_eq!(c.min_version, "1.2.3");
        assert_eq!(c.edit_window_minutes, 30);
        assert_eq!(c.source, Source::Fresh);
    }

    #[test]
    fn wrong_types_and_out_of_range_values_fall_back_per_key() {
        let c = RemoteConfig::from_values(
            &values(json!({"groups.maxMembers": "много", "maintenance.enabled": "yes", "messages.editWindowMinutes": 0, "app.minVersion": "1.2", "files.enabled": false})),
            Source::Fresh,
        );
        assert_eq!(c.group_max_members, 500, "строка вместо числа — умолчание");
        assert!(!c.maintenance, "не логическое значение — умолчание");
        assert_eq!(c.edit_window_minutes, 15, "ноль вне предела — умолчание");
        assert_eq!(c.min_version, "0.0.0", "версия не того вида — умолчание");
        assert!(!c.files_enabled, "правильное значение не сбрасывается");
    }

    #[test]
    fn group_size_outside_the_server_limits_is_refused() {
        for bad in [1u64, 501, 10_000] {
            let c = RemoteConfig::from_values(&values(json!({"groups.maxMembers": bad})), Source::Fresh);
            assert_eq!(c.group_max_members, 500, "{bad} вне 2..500");
        }
    }

    #[test]
    fn unknown_keys_are_ignored() {
        let c = RemoteConfig::from_values(&values(json!({"something.new": true})), Source::Fresh);
        assert!(c.same_values(&RemoteConfig::defaults()));
    }

    #[test]
    fn no_op_service_always_gives_defaults() {
        let s = NoOpRemoteConfigService;
        assert!(s.current().same_values(&RemoteConfig::defaults()));
        assert!(s.refresh().unwrap().same_values(&RemoteConfig::defaults()));
    }

    #[test]
    fn development_service_uses_the_given_values_without_network() {
        let s = DevelopmentRemoteConfigService::new(values(json!({"channels.enabled": false})));
        let c = s.refresh().unwrap();
        assert!(!c.channels_enabled);
        assert_eq!(c.source, Source::Development);
    }
}

#[cfg(test)]
mod version_tests {
    use super::*;

    #[test]
    fn versions_compare_by_numbers_not_by_text() {
        assert!(version_at_least("1.10.0", "1.9.9"), "1.10.0 новее 1.9.9");
        assert!(version_at_least("1.2.3", "1.2.3"), "равная версия проходит");
        assert!(!version_at_least("1.2.2", "1.2.3"));
        assert!(!version_at_least("0.9.0", "1.0.0"));
    }

    #[test]
    fn unclear_versions_do_not_pass() {
        assert!(!version_at_least("1.2", "1.0.0"));
        assert!(!version_at_least("x.y.z", "1.0.0"));
        assert!(!version_at_least("1.2.3", "1.0"));
        assert!(!version_at_least("99999999999.0.0", "1.0.0"), "переполнение не проходит");
    }
}
