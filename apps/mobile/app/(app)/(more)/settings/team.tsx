import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  TextInput,
  Modal,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useState, useMemo } from "react";
import { trpc } from "../../../../src/lib/trpc";
import { makeStyles } from "../../../../src/lib/makeStyles";
import { useColors } from "../../../../src/contexts/ThemeContext";
import { QueryError, Skeleton, Card } from "../../../../src/components/ui";
import { CA_ACCESS_NOTE, caRoleDescription, isCaRole } from "@fintranzact/shared";
import { CA_INVITE_CHOICES, STAFF_INVITE_ROLES, canChangeMemberRole, canManageCa, changeRoleOptions } from "../../../../src/lib/team-roles";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  superadmin: "Super Admin",
  admin: "Admin",
  seller_manager: "Seller Manager",
  seller: "Seller",
  accountant: "Accountant (bookkeeping)",
  auditor: "Accountant (read-only)",
  ca_filing: "Accountant (filing)",
  member: "Member",
  viewer: "Viewer",
};

function RoleBadge({ role }: { role: string }) {
  const badgeStyles = useBadgeStyles();
  const colors = useColors();
  const ROLE_COLORS: Record<string, string> = useMemo(() => ({
    owner: colors.brand,
    superadmin: colors.brand,
    admin: colors.info,
    seller_manager: colors.warning,
    seller: colors.success,
    accountant: colors.amber,
    auditor: colors.info,
    ca_filing: colors.info,
    member: colors.textMuted,
    viewer: colors.textMuted,
  }), [colors]);
  const color = ROLE_COLORS[role] ?? colors.textMuted;
  const label = ROLE_LABELS[role] ?? role;
  return (
    <View style={[badgeStyles.badge, { backgroundColor: color + "20", borderColor: color + "40" }]}>
      <Text style={[badgeStyles.text, { color }]}>{label}</Text>
      {isCaRole(role) && (
        <Text testID="ca-badge" style={[badgeStyles.caTag, { color, borderColor: color + "60" }]}>CA</Text>
      )}
    </View>
  );
}

const useBadgeStyles = makeStyles((_colors) => ({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  text: {
    fontSize: 11,
    fontWeight: "700",
  },
  caTag: {
    fontSize: 9,
    fontWeight: "800",
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 3,
    overflow: "hidden",
  },
}));

type ChangeRoleTarget = { userId: string; currentRole: string; displayName: string } | null;

export default function TeamScreen() {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showCaModal, setShowCaModal] = useState(false);
  const [caEmail, setCaEmail] = useState("");
  const [caRole, setCaRole] = useState("auditor");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("seller");
  const [changeRoleTarget, setChangeRoleTarget] = useState<ChangeRoleTarget>(null);
  const [pendingRole, setPendingRole] = useState("");

  const utils = trpc.useUtils();

  const { data: members, isLoading, isError, refetch, isRefetching } =
    trpc.tenant.members.useQuery(undefined);

  const { data: pendingInvitations, refetch: refetchPending, isRefetching: isPendingRefetching } =
    trpc.tenant.pendingInvitations.useQuery(undefined);

  const { data: me } = trpc.auth.me.useQuery(undefined);
  const myRole = me?.role ?? "";
  const canManage = ["owner", "superadmin", "admin"].includes(myRole);
  // Only the owner brings in a CA or changes a CA's access.
  const canInviteCa = canManageCa(myRole);

  const inviteMutation = trpc.tenant.inviteMember.useMutation({
    onSuccess: (data) => {
      utils.tenant.members.invalidate();
      utils.tenant.pendingInvitations.invalidate();
      setShowInviteModal(false);
      setShowCaModal(false);
      setInviteEmail("");
      setInviteRole("seller");
      setCaEmail("");
      setCaRole("auditor");
      Alert.alert(
        "Invitation sent",
        isCaRole(data.role)
          ? "We emailed them. The invite will appear as pending until accepted. You can remove their access at any time."
          : "We've sent an invitation email. The invite will appear as pending until accepted."
      );
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to send invitation.");
    },
  });

  const updateRoleMutation = trpc.tenant.updateMemberRole.useMutation({
    onSuccess: () => {
      utils.tenant.members.invalidate();
      setChangeRoleTarget(null);
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to update role.");
    },
  });

  const removeMutation = trpc.tenant.removeMember.useMutation({
    onSuccess: () => {
      utils.tenant.members.invalidate();
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to remove member.");
    },
  });

  const revokeMutation = trpc.tenant.revokeInvitation.useMutation({
    onSuccess: () => {
      utils.tenant.pendingInvitations.invalidate();
      Alert.alert("Revoked", "Invitation has been revoked.");
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to revoke invitation.");
    },
  });

  const handleRemove = (userId: string, name: string) => {
    Alert.alert(
      "Remove Member",
      `Remove ${name} from your organization?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => removeMutation.mutate({ userId }),
        },
      ]
    );
  };

  const handleOpenRoleModal = (userId: string, currentRole: string, displayName: string) => {
    setPendingRole(currentRole);
    setChangeRoleTarget({ userId, currentRole, displayName });
  };

  const handleConfirmRoleChange = () => {
    if (!changeRoleTarget || pendingRole === changeRoleTarget.currentRole) {
      setChangeRoleTarget(null);
      return;
    }
    const newLabel = ROLE_LABELS[pendingRole] ?? pendingRole;
    Alert.alert(
      "Change Role",
      `Change ${changeRoleTarget.displayName}'s role to "${newLabel}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          onPress: () =>
            updateRoleMutation.mutate({
              userId: changeRoleTarget.userId,
              role: pendingRole as any,
            }),
        },
      ]
    );
  };

  const handleInvite = () => {
    if (!inviteEmail.trim()) {
      Alert.alert("Validation", "Email is required.");
      return;
    }
    inviteMutation.mutate({
      email: inviteEmail.trim().toLowerCase(),
      role: inviteRole as any,
    });
  };

  const handleInviteCa = () => {
    if (!caEmail.trim()) {
      Alert.alert("Validation", "Email is required.");
      return;
    }
    inviteMutation.mutate({ email: caEmail.trim().toLowerCase(), role: caRole as any });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Team</Text>
        {canManage ? (
          <TouchableOpacity
            style={styles.inviteBtn}
            onPress={() => setShowInviteModal(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="person-add-outline" size={18} color={colors.onBrand} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 44 }} />
        )}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching || isPendingRefetching}
            onRefresh={() => { refetch(); refetchPending(); }}
            tintColor={colors.brand}
            colors={[colors.brand]}
          />
        }
      >
        {isLoading ? (
          <Card>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} width="100%" height={60} borderRadius={8} style={{ marginBottom: 8 }} />
            ))}
          </Card>
        ) : isError ? (
          <QueryError message="Failed to load team members" onRetry={refetch} />
        ) : members && members.length > 0 ? (
          <View style={styles.membersList}>
            {members.map((m, idx) => {
              const isLast = idx === members.length - 1;
              const isMe = m.userId === me?.user?.id;
              const isOwner = m.role === "owner" || m.role === "superadmin";
              const displayName = m.userName || m.userEmail || "Unknown";
              return (
                <View
                  key={m.id}
                  style={[styles.memberRow, !isLast && styles.memberRowBorder]}
                >
                  <View style={styles.memberAvatar}>
                    <Text style={styles.memberAvatarText}>
                      {displayName.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.memberInfo}>
                    <View style={styles.memberNameRow}>
                      <Text style={styles.memberName} numberOfLines={1}>
                        {displayName}
                      </Text>
                      {isMe && <Text style={styles.meLabel}>You</Text>}
                    </View>
                    <Text style={styles.memberEmail} numberOfLines={1}>
                      {m.userEmail}
                    </Text>
                    <View style={styles.memberRoleRow}>
                      {canManage && !isOwner && !isMe && canChangeMemberRole(myRole, m.role) ? (
                        <TouchableOpacity
                          onPress={() => handleOpenRoleModal(m.userId, m.role, displayName)}
                          activeOpacity={0.7}
                          style={styles.roleBadgeBtn}
                        >
                          <RoleBadge role={m.role} />
                          <Ionicons name="chevron-down" size={11} color={colors.textMuted} style={{ marginLeft: 3 }} />
                        </TouchableOpacity>
                      ) : (
                        <RoleBadge role={m.role} />
                      )}
                    </View>
                  </View>
                  {canManage && !isOwner && !isMe && (
                    <TouchableOpacity
                      style={styles.removeBtn}
                      onPress={() => handleRemove(m.userId, displayName)}
                      activeOpacity={0.7}
                      disabled={removeMutation.isPending}
                    >
                      {removeMutation.isPending ? (
                        <ActivityIndicator size="small" color={colors.danger} />
                      ) : (
                        <Ionicons name="person-remove-outline" size={18} color={colors.danger} />
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </View>
        ) : (
          <Card>
            <Text style={styles.emptyText}>No team members found</Text>
          </Card>
        )}

        {/* Pending Invitations */}
        {pendingInvitations && pendingInvitations.length > 0 && (
          <View style={styles.pendingSection}>
            <Text style={styles.sectionLabel}>Pending Invitations</Text>
            <View style={styles.membersList}>
              {pendingInvitations.map((inv, idx) => {
                const isLast = idx === pendingInvitations.length - 1;
                return (
                  <View
                    key={inv.id}
                    style={[styles.memberRow, !isLast && styles.memberRowBorder]}
                  >
                    <View style={[styles.memberAvatar, { backgroundColor: "rgba(251,191,36,0.12)", borderColor: "rgba(251,191,36,0.3)" }]}>
                      <Text style={[styles.memberAvatarText, { color: "#fbbf24" }]}>
                        {inv.email.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.memberInfo}>
                      <Text style={styles.memberEmail} numberOfLines={1}>
                        {inv.email}
                      </Text>
                      <View style={styles.memberRoleRow}>
                        <RoleBadge role={inv.role} />
                      </View>
                      {caRoleDescription(inv.role) ? (
                        <Text style={styles.accessText}>{caRoleDescription(inv.role)}</Text>
                      ) : null}
                    </View>
                    {canManage && (
                      <TouchableOpacity
                        style={styles.removeBtn}
                        onPress={() => {
                          Alert.alert(
                            "Revoke Invitation",
                            `Revoke invitation for ${inv.email}?`,
                            [
                              { text: "Cancel", style: "cancel" },
                              {
                                text: "Revoke",
                                style: "destructive",
                                onPress: () => revokeMutation.mutate({ invitationId: inv.id }),
                              },
                            ],
                          );
                        }}
                        activeOpacity={0.7}
                        disabled={revokeMutation.isPending}
                      >
                        {revokeMutation.isPending ? (
                          <ActivityIndicator size="small" color={colors.danger} />
                        ) : (
                          <Ionicons name="close-circle-outline" size={18} color={colors.danger} />
                        )}
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {canInviteCa && (
          <TouchableOpacity
            style={styles.inviteCaBtn}
            onPress={() => setShowCaModal(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="briefcase-outline" size={20} color={colors.onBrand} />
            <Text style={styles.inviteCaBtnText}>Invite my CA</Text>
          </TouchableOpacity>
        )}

        {canManage && (
          <TouchableOpacity
            style={styles.inviteLargeBtn}
            onPress={() => setShowInviteModal(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="person-add-outline" size={20} color={colors.brand} />
            <Text style={styles.inviteLargeBtnText}>Invite Team Member</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Change Role Modal */}
      <Modal
        visible={!!changeRoleTarget}
        transparent
        animationType="slide"
        onRequestClose={() => setChangeRoleTarget(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Change Role</Text>
              <TouchableOpacity
                onPress={() => setChangeRoleTarget(null)}
                style={styles.modalClose}
              >
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            {changeRoleTarget ? (
              <Text style={styles.roleChangeSubtitle}>
                Select a new role for{" "}
                <Text style={{ color: colors.textPrimary, fontWeight: "700" }}>
                  {changeRoleTarget.displayName}
                </Text>
              </Text>
            ) : null}

            <View style={styles.roleGrid}>
              {changeRoleOptions(myRole).map((r) => (
                <TouchableOpacity
                  key={r.key}
                  style={[styles.rolePill, pendingRole === r.key && styles.rolePillActive]}
                  onPress={() => setPendingRole(r.key)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.rolePillText, pendingRole === r.key && styles.rolePillTextActive]}>
                    {r.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[
                styles.inviteSubmitBtn,
                (updateRoleMutation.isPending || pendingRole === changeRoleTarget?.currentRole) && { opacity: 0.5 },
              ]}
              onPress={handleConfirmRoleChange}
              disabled={updateRoleMutation.isPending || pendingRole === changeRoleTarget?.currentRole}
              activeOpacity={0.8}
            >
              {updateRoleMutation.isPending ? (
                <ActivityIndicator color={colors.onBrand} size="small" />
              ) : (
                <Text style={styles.inviteSubmitBtnText}>Save Role</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Invite Modal */}
      <Modal
        visible={showInviteModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowInviteModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Invite Member</Text>
              <TouchableOpacity
                onPress={() => setShowInviteModal(false)}
                style={styles.modalClose}
              >
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={styles.fieldLabel}>Email Address</Text>
            <TextInput
              style={styles.input}
              value={inviteEmail}
              onChangeText={setInviteEmail}
              placeholder="member@example.com"
              placeholderTextColor={colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={styles.fieldLabel}>Role</Text>
            <View style={styles.roleGrid}>
              {STAFF_INVITE_ROLES.map((r) => (
                <TouchableOpacity
                  key={r.key}
                  style={[styles.rolePill, inviteRole === r.key && styles.rolePillActive]}
                  onPress={() => setInviteRole(r.key)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.rolePillText, inviteRole === r.key && styles.rolePillTextActive]}>
                    {r.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.inviteSubmitBtn, inviteMutation.isPending && { opacity: 0.6 }]}
              onPress={handleInvite}
              disabled={inviteMutation.isPending}
              activeOpacity={0.8}
            >
              {inviteMutation.isPending ? (
                <ActivityIndicator color={colors.onBrand} size="small" />
              ) : (
                <Text style={styles.inviteSubmitBtnText}>Send Invitation</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Invite my CA Modal */}
      <Modal
        visible={showCaModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCaModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Invite your CA</Text>
              <TouchableOpacity onPress={() => setShowCaModal(false)} style={styles.modalClose}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={styles.fieldLabel}>Your CA's email address</Text>
            <TextInput
              style={styles.input}
              value={caEmail}
              onChangeText={setCaEmail}
              placeholder="ca@firm.in"
              placeholderTextColor={colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={styles.fieldLabel}>What can they do?</Text>
            {CA_INVITE_CHOICES.map((c) => (
              <TouchableOpacity
                key={c.key}
                style={[styles.accessCard, caRole === c.key && styles.accessCardActive]}
                onPress={() => setCaRole(c.key)}
                activeOpacity={0.7}
                accessibilityRole="radio"
                accessibilityState={{ selected: caRole === c.key }}
              >
                <Ionicons
                  name={caRole === c.key ? "radio-button-on" : "radio-button-off"}
                  size={20}
                  color={caRole === c.key ? colors.brand : colors.textMuted}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.accessTitle}>{c.title}</Text>
                  <Text style={styles.accessText}>{c.description}</Text>
                </View>
              </TouchableOpacity>
            ))}
            <Text style={[styles.accessText, { marginBottom: 16 }]}>{CA_ACCESS_NOTE}</Text>

            <TouchableOpacity
              style={[styles.inviteSubmitBtn, inviteMutation.isPending && { opacity: 0.6 }]}
              onPress={handleInviteCa}
              disabled={inviteMutation.isPending}
              activeOpacity={0.8}
            >
              {inviteMutation.isPending ? (
                <ActivityIndicator color={colors.onBrand} size="small" />
              ) : (
                <Text style={styles.inviteSubmitBtnText}>Send Invitation</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 20, fontWeight: "700", color: colors.textPrimary },
  inviteBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { padding: 16, paddingBottom: 48 },
  membersList: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  memberRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  memberAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brandLight,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(99,102,241,0.3)",
  },
  memberAvatarText: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.brand,
  },
  memberInfo: { flex: 1 },
  memberNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 2,
  },
  memberName: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.textPrimary,
    flex: 1,
  },
  meLabel: {
    fontSize: 11,
    color: colors.brand,
    fontWeight: "600",
    backgroundColor: colors.brandLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  memberEmail: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 6,
  },
  memberRoleRow: {
    flexDirection: "row",
  },
  roleBadgeBtn: {
    flexDirection: "row",
    alignItems: "center",
  },
  removeBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.dangerBg,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 16,
  },
  inviteLargeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 16,
    paddingVertical: 14,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.brand + "60",
    borderStyle: "dashed",
  },
  inviteLargeBtnText: {
    color: colors.brand,
    fontSize: 15,
    fontWeight: "600",
  },
  inviteCaBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 16,
    paddingVertical: 14,
    backgroundColor: colors.brand,
    borderRadius: 14,
  },
  inviteCaBtnText: {
    color: colors.onBrand,
    fontSize: 15,
    fontWeight: "700",
  },
  accessCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  accessCardActive: {
    borderColor: colors.brand,
  },
  accessTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  accessText: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  roleChangeSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 16,
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  modalClose: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.textPrimary,
    fontSize: 14,
    marginBottom: 16,
  },
  roleGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 20,
  },
  rolePill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rolePillActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  rolePillText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textMuted,
  },
  rolePillTextActive: {
    color: colors.onBrand,
  },
  inviteSubmitBtn: {
    backgroundColor: colors.brand,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  inviteSubmitBtnText: {
    color: colors.onBrand,
    fontSize: 16,
    fontWeight: "700",
  },
  pendingSection: {
    marginTop: 16,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
}));
