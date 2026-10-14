// Domínio das integrações Docline sem I/O nem criptografia (catálogo de
// eventos, novas tentativas, sistemas, formato da chave e proteção contra
// SSRF, reunião na agenda): seguro para a interface. A assinatura fica em ./signing.
export * from './calendar';
export * from './network';
export * from './references';
export * from './webhooks';
