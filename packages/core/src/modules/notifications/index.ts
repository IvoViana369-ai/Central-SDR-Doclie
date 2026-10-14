// Módulo notifications: avisos no app (transferência, atrasos, esquecidos).
// Não depende de outros módulos; quem gera o aviso chama `notify`.
export { notify, type NotificationInput } from './infra/notify';
export { listMyNotifications, markNotificationsRead } from './application/notifications';
