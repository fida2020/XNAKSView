import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../../../core/router/app_router.dart';
import '../../../core/theme/xnak_colors.dart';

/// Birthday (brief §4) — shown ONLY after OTP verification succeeds.
/// XNAKView is 18+ only; this screen picks a plausible default (18 years
/// ago) but the actual minimum-age gate is enforced server-side on
/// `/auth/register` (`lib/age.ts`), never trusted from this client value
/// alone. The birthday is never shown publicly anywhere in the app.
class SignUpBirthdayScreen extends StatefulWidget {
  const SignUpBirthdayScreen({super.key, this.email, this.phone, required this.verificationToken});

  final String? email;
  final String? phone;
  final String verificationToken;

  @override
  State<SignUpBirthdayScreen> createState() => _SignUpBirthdayScreenState();
}

class _SignUpBirthdayScreenState extends State<SignUpBirthdayScreen> {
  late DateTime _selected = DateTime(DateTime.now().year - 18, DateTime.now().month, DateTime.now().day);

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();

    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        foregroundColor: Colors.black,
        leading: IconButton(icon: const Icon(Icons.arrow_back), onPressed: () => Navigator.of(context).maybePop()),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 8),
              const Text("What's your birthday?", style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700, color: Colors.black)),
              const SizedBox(height: 8),
              const Text("Your birthday won't be shown publicly.", style: TextStyle(color: Colors.black54)),
              const SizedBox(height: 24),
              SizedBox(
                height: 220,
                child: CupertinoDatePicker(
                  mode: CupertinoDatePickerMode.date,
                  initialDateTime: _selected,
                  minimumDate: DateTime(now.year - 100),
                  maximumDate: now,
                  onDateTimeChanged: (value) => setState(() => _selected = value),
                ),
              ),
              const Spacer(),
              SizedBox(
                height: 52,
                child: FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: XnakColors.magenta,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(26)),
                  ),
                  onPressed: () => context.pushSignUpCredentials(
                    email: widget.email,
                    phone: widget.phone,
                    verificationToken: widget.verificationToken,
                    dateOfBirth: _selected,
                  ),
                  child: const Text('Next', style: TextStyle(fontWeight: FontWeight.w700)),
                ),
              ),
              const SizedBox(height: 16),
            ],
          ),
        ),
      ),
    );
  }
}
