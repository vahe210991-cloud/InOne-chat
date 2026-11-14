import 'package:flutter/material.dart';

enum ProfileLoadStatus {
  loading,
  unauthenticated,
  empty,
  error,
}

class ProfileLoadStatusBanner extends StatelessWidget {
  const ProfileLoadStatusBanner({
    required this.status,
    super.key,
  });

  final ProfileLoadStatus status;

  @override
  Widget build(BuildContext context) {
    final message = switch (status) {
      ProfileLoadStatus.loading => 'Loading profile…',
      ProfileLoadStatus.unauthenticated =>
        'Sign in through API / Backend test to load your profile.',
      ProfileLoadStatus.empty => 'Profile information is not available yet.',
      ProfileLoadStatus.error =>
        'Could not load profile. Check your connection and try again.',
    };
    final colors = Theme.of(context).colorScheme;

    return Material(
      color: colors.surfaceContainerHighest,
      borderRadius: BorderRadius.circular(12),
      elevation: 3,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            if (status == ProfileLoadStatus.loading)
              const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            else
              Icon(
                status == ProfileLoadStatus.error
                    ? Icons.error_outline
                    : Icons.info_outline,
                color: status == ProfileLoadStatus.error
                    ? colors.error
                    : colors.onSurfaceVariant,
                size: 20,
              ),
            const SizedBox(width: 10),
            Expanded(child: Text(message)),
          ],
        ),
      ),
    );
  }
}
